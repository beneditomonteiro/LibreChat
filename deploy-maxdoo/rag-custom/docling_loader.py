import os
import json
import logging
from typing import Iterator, List
from langchain_core.documents import Document

logger = logging.getLogger(__name__)

class DoclingOfficeLoader:
    """
    Loader for DOCX, XLSX, PPTX using Docling for normalized output.
    Produces Markdown for readable analysis and JSON for structured storage/retrieval.
    """
    def __init__(self, filepath: str):
        self.filepath = filepath

    def lazy_load(self) -> Iterator[Document]:
        try:
            from docling.document_converter import DocumentConverter
            converter = DocumentConverter()
            result = converter.convert(self.filepath)
            
            # Export to Markdown for standard chunking/retrieval
            md_text = result.document.export_to_markdown()
            
            # Export to JSON for structured metadata (tables, slides, sheets)
            json_text = json.dumps(result.document.export_to_dict())
            
            metadata = {
                'source': self.filepath,
                'normalized_type': 'docling_office',
                'has_structured_json': True
            }
            
            yield Document(
                page_content=md_text,
                metadata=metadata,
            )
            
            # Also yield the structured JSON representation as a separate document or store it
            # We yield a summary of structured data to help retrieval
            yield Document(
                page_content=f"Structured JSON Metadata Summary:\n{json_text[:2000]}...",
                metadata={'source': self.filepath, 'type': 'structured_metadata'}
            )
            
        except Exception as e:
            logger.warning(f'[DoclingOfficeLoader] failed for {self.filepath}: {e}')
            yield Document(page_content=f"Error processing office document: {e}", metadata={'source': self.filepath})

    def load(self) -> List[Document]:
        return list(self.lazy_load())
