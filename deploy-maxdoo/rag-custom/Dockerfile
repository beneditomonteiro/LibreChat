# MaxDoo RAG image: pymupdf4llm + docling office extraction + PaddleOCR /extract
# Base pinned by digest for reproducible rebuilds (was :latest, verified 2026-06-11).
FROM ghcr.io/danny-avila/librechat-rag-api-dev-lite@sha256:6dfb6832661ff9c26fa329c823ce266059e33567670a763e9ecb9b566b8daa68

# Office/PDF extraction stack (carried over from the previous overlay)
RUN pip install --no-cache-dir pymupdf4llm==1.27.2.3 docling python-docx openpyxl python-pptx

# PaddleOCR (CPU) — pinned to the combination verified on 2026-06-11
# (requires enable_mkldnn=False, see paddleocr_engine.py).
RUN pip install --no-cache-dir paddlepaddle==3.3.1 paddleocr==3.7.0

COPY document_loader.py /app/app/utils/document_loader.py
COPY office_worker.py /app/app/utils/office_worker.py
COPY docling_loader.py /app/app/utils/docling_loader.py
COPY paddleocr_engine.py /app/app/utils/paddleocr_engine.py
COPY extract_routes.py /app/app/routes/extract_routes.py
COPY patch_main.py /tmp/patch_main.py

RUN python /tmp/patch_main.py && rm /tmp/patch_main.py

# Import check (engine module only — app.* needs runtime env) and model
# pre-download so first request doesn't block on a network fetch.
RUN python -c "import sys; sys.path.insert(0, '/app'); from app.utils import paddleocr_engine; paddleocr_engine.get_engine(); print('paddleocr engine OK, models cached')"
