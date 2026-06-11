"""Minimal self-hosted LibreChat code-interpreter (codeapi) service.

Implements the wire contract consumed by LibreChat (extracted from
@librechat/agents CodeExecutor and api/server/services/Files/Code):

  POST   /v1/exec                          {lang, code, args?, files?}
                                           -> {session_id, stdout, stderr, files}
  GET    /v1/download/{sid}/{fid}?kind&id  -> file stream
  POST   /v1/upload                        multipart kind/id/version? + file
  POST   /v1/upload/batch                  multipart kind/id/version? + files
  DELETE /v1/sessions/{sid}/objects/{fid}  -> 200/404
  DELETE /v1/files/{sid}/{fid}             -> 200/404 (legacy fallback)
  GET    /health

Deployment contract: this service is single-tenant and must only be
reachable on the internal docker network (no published ports). The
`kind`/`id` sessionAuth params are accepted and logged but not enforced —
LibreChat is the only client and it authenticates its own users.

Sandboxing model: code runs in this container as the unprivileged
`sandbox` user with rlimits and a wall-clock timeout. Each execution
gets a fresh session directory exposed at /mnt/data via an atomic
symlink swap; a global lock serializes executions so the symlink is
stable for the lifetime of each run.
"""

import asyncio
import json
import logging
import os
import re
import resource
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("codeapi")

SESSION_ROOT = Path(os.getenv("CODEAPI_SESSION_ROOT", "/data/sessions"))
MNT_DATA = Path("/mnt/data")
RUN_TIMEOUT_SECONDS = max(1.0, int(os.getenv("CODE_API_RUN_TIMEOUT_MS", "120000")) / 1000)
MAX_OUTPUT_CHARS = int(os.getenv("CODEAPI_MAX_OUTPUT_CHARS", "20000"))
MAX_RSS_BYTES = int(os.getenv("CODEAPI_MAX_RSS_BYTES", str(4 * 1024**3)))
MAX_FILE_BYTES = int(os.getenv("CODEAPI_MAX_FILE_BYTES", str(200 * 1024**2)))

LANG_RUNNERS = {
    "py": lambda script, args: ["python3", str(script), *args],
    "bash": lambda script, args: ["bash", str(script), *args],
}

SAFE_SEGMENT = re.compile(r"[^\w.\-]+", re.UNICODE)

app = FastAPI(title="MaxDoo codeapi", docs_url=None, redoc_url=None)
exec_lock = asyncio.Lock()


def session_dir(sid: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", sid):
        raise HTTPException(status_code=400, detail="invalid session id")
    return SESSION_ROOT / sid


def data_dir(sid: str) -> Path:
    return session_dir(sid) / "data"


def manifest_path(sid: str) -> Path:
    return session_dir(sid) / "manifest.json"


def load_manifest(sid: str) -> dict:
    path = manifest_path(sid)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        logger.warning("corrupt manifest for session %s", sid)
        return {}


def save_manifest(sid: str, manifest: dict) -> None:
    manifest_path(sid).write_text(json.dumps(manifest))


def new_session() -> str:
    sid = uuid.uuid4().hex
    data_dir(sid).mkdir(parents=True, exist_ok=True)
    save_manifest(sid, {})
    return sid


def sanitize_relpath(raw: str) -> str:
    normalized = (raw or "file").replace("\\", "/")
    segments = []
    for segment in normalized.split("/"):
        if segment in ("", ".", ".."):
            continue
        cleaned = SAFE_SEGMENT.sub("_", segment).strip("_") or "file"
        segments.append(cleaned)
    return "/".join(segments) or "file"


def point_mnt_data(target: Path) -> None:
    """Atomically repoint the /mnt/data symlink at the session data dir."""
    tmp_link = MNT_DATA.parent / f".mnt-data-{uuid.uuid4().hex}"
    os.symlink(target, tmp_link)
    os.replace(tmp_link, MNT_DATA)


def set_rlimits() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (MAX_RSS_BYTES, MAX_RSS_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
    cpu_seconds = int(RUN_TIMEOUT_SECONDS) * 2
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    os.setsid()


def truncate(output: str) -> str:
    if len(output) <= MAX_OUTPUT_CHARS:
        return output
    return output[:MAX_OUTPUT_CHARS] + f"\n... [truncated at {MAX_OUTPUT_CHARS} chars]"


def snapshot(root: Path) -> dict:
    state = {}
    for path in root.rglob("*"):
        if path.is_file():
            stat = path.stat()
            state[str(path.relative_to(root))] = (stat.st_size, stat.st_mtime_ns)
    return state


def run_subprocess(cmd: list, cwd: Path) -> tuple:
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(cwd),
        "LANG": "C.UTF-8",
        "MPLCONFIGDIR": "/tmp/mplconfig",
        "PYTHONUNBUFFERED": "1",
    }
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=RUN_TIMEOUT_SECONDS,
            preexec_fn=set_rlimits,
        )
        return proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", "replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        return stdout, f"{stderr}\nExecution timed out after {RUN_TIMEOUT_SECONDS:.0f}s"


def copy_injected_files(refs: list, target_root: Path) -> dict:
    """Copy injected file refs into the new session. Returns
    {relpath: source_file_id} for inherited-flag bookkeeping."""
    injected = {}
    for ref in refs or []:
        if not isinstance(ref, dict):
            continue
        file_id = str(ref.get("id", ""))
        source_sid = str(ref.get("session_id", ""))
        name = ref.get("name")
        if not file_id or not source_sid:
            continue
        try:
            source_manifest = load_manifest(source_sid)
        except HTTPException:
            continue
        relpath = source_manifest.get(file_id)
        if relpath is None:
            logger.warning("injected file %s/%s not found", source_sid, file_id)
            continue
        source_path = data_dir(source_sid) / relpath
        if not source_path.is_file():
            continue
        dest_rel = sanitize_relpath(name or relpath)
        dest = target_root / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, dest)
        injected[dest_rel] = file_id
    return injected


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/v1/exec")
async def exec_code(request: Request):
    body = await request.json()
    lang = body.get("lang")
    code = body.get("code")
    args = [str(a) for a in body.get("args") or []]
    file_refs = body.get("files") or []

    if not isinstance(code, str) or not code.strip():
        raise HTTPException(status_code=400, detail="code is required")

    sid = new_session()
    sdir = data_dir(sid)

    if lang not in LANG_RUNNERS:
        supported = ", ".join(sorted(LANG_RUNNERS))
        return {
            "session_id": sid,
            "stdout": "",
            "stderr": (
                f"Language '{lang}' is not supported by this self-hosted sandbox. "
                f"Supported: {supported}. Re-write the code in one of those."
            ),
            "files": [],
        }

    async with exec_lock:
        injected = copy_injected_files(file_refs, sdir)
        before = snapshot(sdir)

        ext = "py" if lang == "py" else "sh"
        script = session_dir(sid) / f"script.{ext}"
        script.write_text(code)

        cmd = LANG_RUNNERS[lang](script, args)
        point_mnt_data(sdir)
        stdout, stderr = await asyncio.to_thread(run_subprocess, cmd, sdir)

        manifest = {}
        files = []
        after = snapshot(sdir)
        for relpath, signature in sorted(after.items()):
            unchanged = before.get(relpath) == signature
            inherited = unchanged and relpath in injected
            file_id = injected[relpath] if inherited else uuid.uuid4().hex
            manifest[file_id] = relpath
            entry = {"id": file_id, "name": relpath, "session_id": sid}
            if inherited:
                entry["inherited"] = True
            files.append(entry)
        save_manifest(sid, manifest)

    logger.info(
        "exec lang=%s session=%s files=%d stdout=%dB stderr=%dB",
        lang,
        sid,
        len(files),
        len(stdout),
        len(stderr),
    )
    return {
        "session_id": sid,
        "stdout": truncate(stdout),
        "stderr": truncate(stderr),
        "files": files,
    }


@app.get("/v1/download/{sid}/{file_id}")
async def download(sid: str, file_id: str, kind: Optional[str] = None, id: Optional[str] = None):
    manifest = load_manifest(sid)
    relpath = manifest.get(file_id)
    if relpath is None:
        raise HTTPException(status_code=404, detail="file not found")
    path = data_dir(sid) / relpath
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(path, filename=Path(relpath).name)


async def store_upload(sid: str, upload: UploadFile) -> dict:
    relpath = sanitize_relpath(upload.filename)
    dest = data_dir(sid) / relpath
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with dest.open("wb") as fh:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="file too large")
            fh.write(chunk)
    file_id = uuid.uuid4().hex
    manifest = load_manifest(sid)
    manifest[file_id] = relpath
    save_manifest(sid, manifest)
    return {"fileId": file_id, "filename": relpath}


@app.post("/v1/upload")
async def upload(
    file: UploadFile = File(...),
    kind: str = Form("user"),
    id: str = Form(""),
    version: str = Form(None),
):
    sid = new_session()
    stored = await store_upload(sid, file)
    return {"message": "success", "storage_session_id": sid, "files": [stored]}


@app.post("/v1/upload/batch")
async def upload_batch(
    request: Request,
    kind: str = Form("user"),
    id: str = Form(""),
    version: str = Form(None),
    read_only: str = Form(None),
):
    form = await request.form()
    uploads = [value for key, value in form.multi_items() if key == "file"]
    if not uploads:
        raise HTTPException(status_code=400, detail="no files provided")

    sid = new_session()
    results = []
    succeeded = 0
    failed = 0
    for item in uploads:
        try:
            stored = await store_upload(sid, item)
            results.append({"status": "success", **stored})
            succeeded += 1
        except HTTPException as exc:
            results.append(
                {"status": "error", "filename": item.filename, "error": str(exc.detail)}
            )
            failed += 1

    message = "success" if failed == 0 else ("partial" if succeeded else "error")
    return {
        "message": message,
        "storage_session_id": sid,
        "files": results,
        "succeeded": succeeded,
        "failed": failed,
    }


def delete_object(sid: str, file_id: str) -> None:
    manifest = load_manifest(sid)
    relpath = manifest.pop(file_id, None)
    if relpath is None:
        raise HTTPException(status_code=404, detail="file not found")
    path = data_dir(sid) / relpath
    path.unlink(missing_ok=True)
    save_manifest(sid, manifest)


@app.delete("/v1/sessions/{sid}/objects/{file_id}")
async def delete_session_object(sid: str, file_id: str):
    delete_object(sid, file_id)
    return {"message": "deleted"}


@app.delete("/v1/files/{sid}/{file_id}")
async def delete_file_legacy(sid: str, file_id: str):
    delete_object(sid, file_id)
    return {"message": "deleted"}


@app.on_event("startup")
async def startup():
    SESSION_ROOT.mkdir(parents=True, exist_ok=True)
    Path("/tmp/mplconfig").mkdir(exist_ok=True)
    bootstrap = SESSION_ROOT / "bootstrap"
    bootstrap.mkdir(exist_ok=True)
    if not MNT_DATA.is_symlink():
        point_mnt_data(bootstrap)
    logger.info(
        "codeapi ready | sessions=%s timeout=%.0fs", SESSION_ROOT, RUN_TIMEOUT_SECONDS
    )
