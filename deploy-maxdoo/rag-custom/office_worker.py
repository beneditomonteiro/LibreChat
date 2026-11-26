import threading
import queue
import time
import json
import logging
from pathlib import Path
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

@dataclass
class OfficeArtifact:
    filepath: str
    markdown_content: str
    json_metadata: str
    status: str
    error: str = ""

class OfficeBackgroundWorker:
    """
    Background worker that extracts structured metadata and Markdown from office files.
    Ensures that slow Docling extractions do not block UX.
    """
    def __init__(self, storage_dir: str = "/tmp/office_artifacts"):
        self.queue = queue.Queue()
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.worker_thread = threading.Thread(target=self._process_queue, daemon=True)
        self.worker_thread.start()

    def submit_file(self, filepath: str):
        self.queue.put(filepath)

    def _process_queue(self):
        while True:
            filepath = self.queue.get()
            if filepath is None:
                break
            try:
                self._normalize_file(filepath)
            except Exception as e:
                logger.error(f"Background processing failed for {filepath}: {e}")
            finally:
                self.queue.task_done()

    def _normalize_file(self, filepath: str):
        try:
            from docling.document_converter import DocumentConverter
            converter = DocumentConverter()
            result = converter.convert(filepath)
            
            md_content = result.document.export_to_markdown()
            
            # Use Docling's dict export for structured extraction
            structured_data = result.document.export_to_dict()
            json_meta = json.dumps(structured_data)
            
            artifact = OfficeArtifact(
                filepath=filepath,
                markdown_content=md_content,
                json_metadata=json_meta,
                status="completed"
            )
            
            out_path = self.storage_dir / (Path(filepath).name + ".json")
            with open(out_path, 'w') as f:
                json.dump(asdict(artifact), f)
                
            logger.info(f"Successfully normalized {filepath} in background.")
        except Exception as e:
            logger.error(f"Docling conversion error for {filepath}: {e}")

_worker = OfficeBackgroundWorker()

def submit_office_file(filepath: str):
    _worker.submit_file(filepath)
