"""PaddleOCR extraction engine for the /extract endpoint.

Lazy-initializes a single CPU PaddleOCR pipeline and serializes OCR runs
behind a lock — the engine is not thread-safe and a single inference can
use >1GB RAM, so concurrent requests queue instead of stacking.

Result parsing tolerates both the 3.x `predict()` (OCRResult mappings with
`rec_texts`) and the legacy 2.x `.ocr()` (list of [box, (text, score)])
shapes so a base-image bump doesn't silently break extraction.
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)

PDF_MIME = "application/pdf"

_engine = None
_engine_lock = threading.Lock()
_ocr_lock = threading.Lock()

_DPI = int(os.getenv("PADDLEOCR_PDF_DPI", "200"))
_MAX_PAGES = int(os.getenv("PADDLEOCR_MAX_PAGES", "50"))


def is_supported(content_type: str, filename: str) -> bool:
    """PaddleOCR path only handles PDFs and raster images; everything else
    must 400 so the app's strategy loop falls back to document_parser."""
    name = (filename or "").lower()
    if content_type == PDF_MIME or name.endswith(".pdf"):
        return True
    if content_type and content_type.startswith("image/"):
        return True
    return name.endswith((".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"))


def get_engine():
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        # oneDNN's PIR executor crashes on the OCR det model with
        # "ConvertPirAttribute2RuntimeAttribute not support" on paddlepaddle
        # 3.3.x CPU — disable mkldnn before the engine is built (verified
        # fix on paddleocr 3.7.0 / paddlepaddle 3.3.1, 2026-06-11).
        os.environ.setdefault("FLAGS_use_mkldnn", "0")
        from paddleocr import PaddleOCR

        lang = os.getenv("PADDLEOCR_LANG", "pt")
        try:
            engine = PaddleOCR(
                lang=lang,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=True,
                enable_mkldnn=False,
            )
        except (TypeError, ValueError):
            # Older constructor signature (2.x)
            engine = PaddleOCR(lang=lang, use_angle_cls=True, show_log=False)
        logger.info("PaddleOCR engine initialized (lang=%s)", lang)
        _engine = engine
    return _engine


def _run_ocr(engine, image):
    predict = getattr(engine, "predict", None)
    if callable(predict):
        return predict(image)
    return engine.ocr(image)


def _texts_from_result(result) -> list:
    texts = []
    if result is None:
        return texts
    for res in result:
        if res is None:
            continue
        rec_texts = None
        try:
            rec_texts = res["rec_texts"]
        except (TypeError, KeyError, IndexError):
            rec_texts = None
        if rec_texts is not None:
            texts.extend(t for t in rec_texts if t)
            continue
        if isinstance(res, list):
            for line in res:
                try:
                    text = line[1][0]
                except (TypeError, IndexError, KeyError):
                    continue
                if text:
                    texts.append(text)
    return texts


def _extract_pdf(path: str) -> str:
    import fitz  # PyMuPDF, already a base-image dependency
    import numpy as np

    engine = get_engine()
    pages = []
    with fitz.open(path) as doc:
        page_count = min(doc.page_count, _MAX_PAGES)
        if doc.page_count > _MAX_PAGES:
            logger.warning(
                "PDF has %d pages; OCR capped at %d (PADDLEOCR_MAX_PAGES)",
                doc.page_count,
                _MAX_PAGES,
            )
        for index in range(page_count):
            page = doc.load_page(index)
            pix = page.get_pixmap(dpi=_DPI, colorspace=fitz.csRGB, alpha=False)
            image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, 3
            )
            page_texts = _texts_from_result(_run_ocr(engine, image))
            pages.append("\n".join(page_texts))
    return "\n\n".join(filter(None, pages))


def _extract_image(path: str) -> str:
    engine = get_engine()
    return "\n".join(_texts_from_result(_run_ocr(engine, path)))


def extract_text(path: str, content_type: str, filename: str) -> str:
    """Blocking OCR extraction — call from a thread pool, never the event loop."""
    with _ocr_lock:
        name = (filename or "").lower()
        if content_type == PDF_MIME or name.endswith(".pdf"):
            return _extract_pdf(path)
        return _extract_image(path)
