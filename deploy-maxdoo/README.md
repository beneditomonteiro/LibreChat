# deploy-maxdoo — MaxDoo LibreChat deployment (chat.maxdoo.tech)

Source of truth for the LibreChat stack on `178.105.34.35` (u22-maxai-cloud).
Everything that used to live only on the host (`/home/odoo/librechat-maxai/`)
is versioned here; the host copies are build/deploy artifacts.

## Layout

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Stack definition (pinned tags via `MAXDOO_TAG` in host `.env`) |
| `deploy.sh` | Clean-source build + pin + deploy + agent seed (run on the host) |
| `rag-custom/` | RAG image overlay: pymupdf4llm/docling office extraction + **PaddleOCR `/extract`** |
| `codeapi/` | Minimal self-hosted LibreChat code-interpreter (sandbox) service |

## Images (built by deploy.sh, tagged `maxdoo-<git short sha>`)

- `librechat-maxdoo` — the app, built from the repo `Dockerfile`
- `librechat-rag-paddleocr` — RAG API + `/extract` endpoint (PaddleOCR strategy)
- `librechat-codeapi` — sandbox behind `LIBRECHAT_CODE_BASEURL=http://codeapi:8700/v1`

## Deploy

```bash
ssh root@178.105.34.35
cd /home/odoo/librechat-maxai
bash src/deploy-maxdoo/deploy.sh            # deploys origin/codex/upload-file-search HEAD
bash src/deploy-maxdoo/deploy.sh <git-ref>  # deploy a specific revision
```

Rollback: previous tags stay on the host — set `MAXDOO_TAG=<old tag>` in
`/home/odoo/librechat-maxai/.env` and `docker compose up -d`.

## PaddleOCR flow

Client toggle (`Settings → General → Enable Advanced Extraction`) →
`enablePaddleOCR` form field → `api/server/services/Files/process.js`
strategy selection → `packages/api/src/files/paddleocr/crud.ts` →
`POST ${RAG_API_URL}/extract` (multipart, `strategy=paddleocr`) →
`rag-custom/extract_routes.py` → `paddleocr_engine.py`. Failure at any point
falls back to the document parser; toggle OFF keeps the standard path.

## codeapi sandbox — contract and limits

Implements the endpoints LibreChat actually calls: `POST /v1/exec`,
`GET /v1/download/{sid}/{fid}`, `POST /v1/upload`, `POST /v1/upload/batch`,
`DELETE /v1/sessions/{sid}/objects/{fid}`.

Security model: **single-tenant, internal-network only** (no published port).
Code runs as the unprivileged `sandbox` user with rlimits (4GB AS, 200MB file
size, CPU cap) and a 120s wall-clock timeout; executions are serialized.
Supported languages: `py`, `bash`. Do NOT publish this service or point
multi-tenant traffic at it without real isolation (gVisor/firecracker).

## Agent seeding

`scripts/seed-doc-agent.js` upserts every manifest in
`packages/api/src/agents/predefined/` by `id` (idempotent). Run automatically
by `deploy.sh`. Current manifests: `doc-generator.json`,
`office-specialist.json`.
