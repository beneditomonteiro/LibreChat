"""Strategy-driven extraction endpoint consumed by LibreChat's
`uploadPaddleOCR` (packages/api/src/files/paddleocr/crud.ts).

Contract: POST /extract — multipart `file` + `strategy` form field.
Response: `{"text": str, "filename": str, "images": []}`.
Errors use 4xx so the app-side strategy loop falls back to the
document parser instead of treating the failure as fatal.

Auth: the global `security_middleware` in app/middleware.py already
enforces the shared-secret JWT on every non-public path, including
this one — same guarantee as /text and /embed.
"""

import asyncio
import traceback

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from app.config import logger
from app.utils.paddleocr_engine import extract_text, is_supported

router = APIRouter()

SUPPORTED_STRATEGIES = {"paddleocr"}


@router.post("/extract")
async def extract_with_strategy(
    request: Request,
    file: UploadFile = File(...),
    strategy: str = Form("paddleocr"),
    entity_id: str = Form(None),
):
    from app.routes.document_routes import (
        _make_unique_temp_path,
        cleanup_temp_file_async,
        get_user_id,
        save_upload_file_async,
    )

    if strategy not in SUPPORTED_STRATEGIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported extraction strategy: {strategy}",
        )

    if not is_supported(file.content_type, file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"File type {file.content_type} is not supported by the "
                "paddleocr strategy (PDF and image files only)"
            ),
        )

    user_id = get_user_id(request, entity_id)
    temp_path = _make_unique_temp_path(user_id, file.filename)
    if temp_path is None:
        logger.warning("Path validation failed for extraction: %s", file.filename)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request",
        )

    import os

    try:
        os.makedirs(os.path.dirname(temp_path), exist_ok=True)
        await save_upload_file_async(file, temp_path)

        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(
            request.app.state.thread_pool,
            extract_text,
            temp_path,
            file.content_type,
            file.filename,
        )

        logger.info(
            "PaddleOCR extraction completed | file=%s chars=%d",
            file.filename,
            len(text),
        )
        return {"text": text, "filename": file.filename, "images": []}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "PaddleOCR extraction failed | file=%s error=%s | %s",
            file.filename,
            str(e),
            traceback.format_exc(),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"PaddleOCR extraction failed: {str(e)}",
        )
    finally:
        await cleanup_temp_file_async(temp_path)
