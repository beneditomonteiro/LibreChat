# app/utils/document_loader.py — MaxDoo fork
# PDF upgraded to pymupdf4llm (Markdown output, structure-aware)

import os
import codecs
import tempfile

from typing import Iterator, List, Optional
import chardet

from langchain_core.documents import Document

from app.config import known_source_ext, PDF_EXTRACT_IMAGES, CHUNK_OVERLAP, logger
from langchain_community.document_loaders import (
    TextLoader,
    PyPDFLoader,
    CSVLoader,
    Docx2txtLoader,
    UnstructuredEPubLoader,
    UnstructuredMarkdownLoader,
    UnstructuredXMLLoader,
    UnstructuredRSTLoader,
    UnstructuredExcelLoader,
    UnstructuredPowerPointLoader,
)
from .docling_loader import DoclingOfficeLoader
from .office_worker import submit_office_file


_BINARY_FILE_EXTENSIONS = frozenset(
    {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'}
)


class PyMuPDFMarkdownLoader:
    '''High-quality PDF loader using pymupdf4llm.
    Outputs Markdown — preserves headings, tables, columns and lists.
    Falls back to PyPDF if pymupdf4llm is unavailable or fails.'''

    def __init__(self, filepath: str, **kwargs):
        self.filepath = filepath
        self._temp_filepath = None

    def lazy_load(self) -> Iterator[Document]:
        try:
            import pymupdf4llm
            md_text = pymupdf4llm.to_markdown(self.filepath)
            yield Document(
                page_content=md_text,
                metadata={'source': self.filepath},
            )
        except Exception as e:
            logger.warning(
                f'[PyMuPDFMarkdownLoader] pymupdf4llm failed for {self.filepath}, '
                f'falling back to PyPDF: {e}'
            )
            fallback = PyPDFLoader(self.filepath, extract_images=False)
            yield from fallback.lazy_load()

    def load(self) -> List[Document]:
        return list(self.lazy_load())


def detect_file_encoding(filepath: str) -> str:
    with open(filepath, 'rb') as f:
        raw = f.read(4096)
    if raw.startswith(codecs.BOM_UTF16_LE):
        return 'utf-16-le'
    elif raw.startswith(codecs.BOM_UTF16_BE):
        return 'utf-16-be'
    elif raw.startswith(codecs.BOM_UTF16):
        return 'utf-16'
    elif raw.startswith(codecs.BOM_UTF8):
        return 'utf-8-sig'
    elif raw.startswith(codecs.BOM_UTF32_LE):
        return 'utf-32-le'
    elif raw.startswith(codecs.BOM_UTF32_BE):
        return 'utf-32-be'
    result = chardet.detect(raw)
    encoding = result.get('encoding')
    if encoding:
        return encoding.lower()
    return 'utf-8'


def cleanup_temp_encoding_file(loader) -> None:
    if hasattr(loader, '_temp_filepath') and loader._temp_filepath is not None:
        try:
            os.remove(loader._temp_filepath)
        except Exception as e:
            logger.warning(f'Failed to remove temporary UTF-8 file: {e}')


def get_loader(filename: str, file_content_type: str, filepath: str, raw_text: bool = False):
    file_ext = filename.split('.')[-1].lower()
    known_type = True

    if file_ext == 'pdf' or file_content_type == 'application/pdf':
        loader = PyMuPDFMarkdownLoader(filepath)
    elif file_ext == 'csv' or file_content_type == 'text/csv':
        encoding = detect_file_encoding(filepath)
        if encoding != 'utf-8':
            temp_file = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode='w', encoding='utf-8', suffix='.csv', delete=False
                ) as temp_file:
                    with open(filepath, 'r', encoding=encoding, errors='replace') as original_file:
                        while True:
                            chunk = original_file.read(64 * 1024)
                            if not chunk:
                                break
                            temp_file.write(chunk)
                    temp_filepath = temp_file.name
                loader = CSVLoader(temp_filepath)
                loader._temp_filepath = temp_filepath
            except Exception as e:
                if temp_file and os.path.exists(temp_file.name):
                    os.unlink(temp_file.name)
                raise e
        else:
            loader = CSVLoader(filepath)
    elif file_ext == 'rst':
        loader = UnstructuredRSTLoader(filepath, mode='elements')
    elif file_ext == 'xml' or file_content_type in [
        'application/xml', 'text/xml', 'application/xhtml+xml'
    ]:
        loader = UnstructuredXMLLoader(filepath)
    elif file_ext in ['ppt', 'pptx'] or file_content_type in [
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]:
        submit_office_file(filepath)
        loader = DoclingOfficeLoader(filepath)
    elif file_ext == 'md' or (
        file_content_type in [
            'text/markdown', 'text/x-markdown', 'application/markdown', 'application/x-markdown'
        ] and file_ext not in _BINARY_FILE_EXTENSIONS
    ):
        if raw_text:
            loader = TextLoader(filepath, autodetect_encoding=True)
        else:
            loader = UnstructuredMarkdownLoader(filepath)
    elif file_ext == 'epub' or file_content_type == 'application/epub+zip':
        loader = UnstructuredEPubLoader(filepath)
    elif file_ext in ['doc', 'docx'] or file_content_type in [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]:
        submit_office_file(filepath)
        loader = DoclingOfficeLoader(filepath)
    elif file_ext in ['xls', 'xlsx'] or file_content_type in [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]:
        submit_office_file(filepath)
        loader = DoclingOfficeLoader(filepath)
    elif file_ext == 'json' or file_content_type == 'application/json':
        loader = TextLoader(filepath, autodetect_encoding=True)
    elif file_ext in known_source_ext or (file_content_type and file_content_type.find('text/') >= 0):
        loader = TextLoader(filepath, autodetect_encoding=True)
    else:
        loader = TextLoader(filepath, autodetect_encoding=True)
        known_type = False

    return loader, known_type, file_ext


def clean_text(text: str) -> str:
    text = remove_null(text)
    text = remove_non_utf8(text)
    return text


def remove_null(text: str) -> str:
    return text.replace('\x00', '')


def remove_non_utf8(text: str) -> str:
    try:
        return text.encode('utf-8', 'ignore').decode('utf-8')
    except UnicodeError:
        return text


def process_documents(documents: List[Document]) -> str:
    processed_text = ''
    last_page: Optional[int] = None
    doc_basename = ''

    for doc in documents:
        if 'source' in doc.metadata:
            doc_basename = doc.metadata['source'].split('/')[-1]
            break

    processed_text += f'{doc_basename}\n'

    for doc in documents:
        current_page = doc.metadata.get('page')
        if current_page and current_page != last_page:
            processed_text += f'\n# PAGE {doc.metadata["page"]}\n\n'
            last_page = current_page

        new_content = doc.page_content
        if processed_text.endswith(new_content[:CHUNK_OVERLAP]):
            processed_text += new_content[CHUNK_OVERLAP:]
        else:
            processed_text += new_content

    return processed_text.strip()
