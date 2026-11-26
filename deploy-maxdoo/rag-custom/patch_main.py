"""Build-time patch: register extract_routes in the RAG API's main.py.

Idempotent — re-running on an already-patched main.py is a no-op.
Fails the build loudly if the anchor line disappears in a base bump.
"""

import pathlib

MAIN = pathlib.Path("/app/main.py")
ANCHOR = "app.include_router(document_routes.router)"
ADDITION = (
    "from app.routes import extract_routes\n"
    "app.include_router(extract_routes.router)"
)

source = MAIN.read_text()
if "extract_routes" in source:
    print("main.py already registers extract_routes — skipping")
else:
    if ANCHOR not in source:
        raise SystemExit(
            "ERROR: anchor line not found in /app/main.py — base image layout "
            "changed; update patch_main.py"
        )
    source = source.replace(ANCHOR, f"{ANCHOR}\n{ADDITION}", 1)
    MAIN.write_text(source)
    print("main.py patched: extract_routes registered")
