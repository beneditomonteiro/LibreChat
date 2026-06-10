# LibreChat PaddleOCR and Unified Document Extraction Plan

## Goal

Unify LibreChat's document ingestion so PDFs, Office files, scans, and plain text all flow through one strategy-driven extraction contract, while adding PaddleOCR as the first new high-accuracy backend for complex documents.

## Review Notes

- The current architecture is already split into multiple extraction layers:
  - `packages/api/src/files/text.ts` handles plain text and markdown, with a RAG API call to `/text` and a native fallback.
  - `packages/api/src/files/documents/crud.ts` handles PDF, DOCX, XLSX, and ODT through native parsers.
  - `api/server/services/Files/process.js` chooses between OCR, document parsing, text parsing, speech-to-text, and file search.
  - `packages/data-provider/src/config.ts` already exposes an OCR strategy enum.
- Because that split already exists, the improvement should not add a second unrelated pipeline.
- PaddleOCR should be introduced as a new extraction strategy inside the existing selection layer, not as a one-off exception.
- The frontend toggle, if kept, should only persist a preference. The backend must remain the source of truth for the actual extraction strategy.

## What To Preserve

- Keep the native parser path for plain text, markdown, and existing Office/PDF fallbacks.
- Keep the current RAG API text path intact.
- Keep existing OCR providers and document parser support.
- Avoid removing any current file-type handling until PaddleOCR is proven in staging.

## Proposed Direction

### 1. Treat extraction as a strategy, not a boolean

- Extend the shared OCR strategy model instead of introducing a separate parallel subsystem.
- Prefer a single extraction entrypoint in the RAG/container layer with a strategy selector.
- Use a dedicated `/extract/paddleocr` endpoint only if the current RAG service cannot support a strategy flag cleanly.

### 2. Keep backend ownership of routing

- Let the backend decide when a file should use native parsing, document parsing, or PaddleOCR.
- If the UI exposes `usePaddleOCR`, treat it as an override that is translated into backend metadata or config.
- Do not make the frontend the only place where extraction behavior is decided.

### 3. Keep the result contract stable

- Return the same shape expected by downstream consumers, ideally compatible with the current OCR/document-parser result shape:
  - `text`
  - `bytes`
  - `filepath`
  - `images`
  - optional metadata if needed
- Do not force downstream upload code to special-case PaddleOCR.

## Implementation Plan

### Phase 1: Shared model and config

- Add a new OCR strategy entry for PaddleOCR in the shared data-provider layer.
- Update schema validation so the strategy can be loaded from config safely.
- Keep `document_parser` and existing OCR providers available as fallbacks.

### Phase 2: RAG/container extraction backend

- Add PaddleOCR dependencies to the RAG container image.
- Implement a single extraction dispatcher that can route by strategy.
- Prefer a strategy parameter on an existing endpoint over adding many new routes.
- If a new endpoint is required, keep it as a thin adapter over the same internal extraction service.

### Phase 3: LibreChat backend wiring

- Wire the upload path so agent/document uploads can request PaddleOCR when appropriate.
- Reuse the existing OCR decision flow in `api/server/services/Files/process.js`.
- Keep plain text and markdown on the current text path.
- Keep the existing document parser fallback for unsupported or failed OCR cases.

### Phase 4: Frontend preference and localization

- Add a local preference only if a user-facing override is still needed after the backend strategy is in place.
- If retained, add the toggle in `client/src/components/Nav/SettingsTabs/General/General.tsx`.
- Persist the setting in `client/src/store/settings.ts`.
- Add the English label in `client/src/locales/en/translation.json`.
- Make the label explicit that this is an advanced extraction mode for complex PDFs and scans.

### Phase 5: Tests and rollout

- Add unit tests for strategy selection and fallback behavior.
- Add integration tests for:
  - PDF extraction
  - DOCX extraction
  - XLSX extraction
  - scanned PDF extraction
  - fallback when PaddleOCR fails
- Verify that turning the feature off reverts to the current behavior without code changes.

## Non-Goals

- Do not replace the native document parser.
- Do not route all files through OCR.
- Do not create multiple competing file-extraction pipelines.
- Do not delete the current RAG text or document flows.

## Acceptance Criteria

- Complex scanned PDFs extract better with PaddleOCR.
- Existing Office documents still work when PaddleOCR is disabled or fails.
- Plain text and markdown continue to use the native/RAG text path.
- The backend has one clear place to decide extraction strategy.
- Any frontend toggle is only a preference, not a second source of truth.

## Open Questions

- Should PaddleOCR live behind the existing OCR strategy abstraction, or should it be a generic extraction engine in the RAG container?
- Should the preference be per-user, per-workspace, or server-configured only?
- Which file types should bypass PaddleOCR even when it is enabled?

