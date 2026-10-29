# ADR-009: Full-Text Search, Text Extraction, and Asynchronous OCR

## Status
Accepted

## Context
Following Milestone 1 (safety foundation), Milestone 2 (reviewed code configuration for document types, JSONB custom metadata, duplicate detection), and Milestone 3 (lifecycle status, relationships, version history, tags, and importer):
1. **Search Limitations:** The Document Center previously searched only core metadata fields (`subject`, `document_number`, `persons_involved`, `file_name`, `filing_subcategory`). Users searching for terms that appear only in the body of an official resolution, memorandum, or contract could not locate the document.
2. **Filipino/Cebuano Language Requirements:** KWD documents frequently use Filipino, Cebuano, and English names, places, and terms (e.g., "Barangay Poblacion", "Kiblawan Water District", "Sanggunian", resolution numbers with slashes and dashes). Standard PostgreSQL `'english'` full-text stemming mangles non-English words and acronyms.
3. **Upload Latency & Scoped Storage Constraints:** Extracting text and running OCR synchronously inside the upload HTTP request risks request timeouts on Vercel and poor user experience. Furthermore, because Google Drive storage operates under the restricted `drive.file` scope (Decision #2), external OCR tools cannot access files directly from Drive by ID.

## Decision

### 1. Two-Tiered Extraction Strategy with Drive Native OCR
- **Tier 1 (Digital Files):** Extract the native text layer directly for plain text and digital PDFs.
- **Tier 2 (Scanned Files & Images):** Use Google Drive's native OCR via Google Docs conversion:
  - Under the existing `drive.file` scope, the application can create a temporary Google Doc file with `mimeType: 'application/vnd.google-apps.document'` from the uploaded image or scanned PDF bytes/file ID.
  - Export the generated document as plain text (`text/plain`) to capture the extracted OCR text.
  - Delete the temporary Google Doc immediately.
  - This avoids third-party cloud OCR fees, requires no new API keys, and stays completely within the approved `drive.file` authorization boundary.

### 2. Asynchronous Job Processing (`ocr_jobs`)
- Upload operations never wait for OCR. The upload finalizer inserts a job into `public.ocr_jobs` with status `PENDING`.
- A background worker claims jobs with atomic leases (`lock_token`, `lock_expires_at`), extracts text, updates `public.document_text`, and transitions the job to `COMPLETED` or `FAILED` (with exponential backoff up to 3 attempts).
- An OCR status indicator (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `NOT_APPLICABLE`) is displayed on the document detail page, with a retry action for administrators.

### 3. Text Storage & 'simple' Full-Text Search Configuration (`document_text`)
- Extracted text is stored in `public.document_text` with an auto-generated `tsv tsvector` using PostgreSQL's `'simple'` dictionary:
  `tsv tsvector generated always as (to_tsvector('simple', extracted_text)) stored`
- A GIN index is maintained on `tsv` for sub-millisecond full-text queries.
- A trigram GIN index (`pg_trgm`) is added on `extracted_text` to support fuzzy partial-word matching on reference numbers and names.

### 4. Confidentiality Boundary
- Full-text search queries strictly enforce `public.can_read_document(auth.jwt() ->> 'email', d.deletion_state, d.confidential)`.
- Non-admin users will **never** receive search hits, headlines, snippets, or count indicators from documents marked `confidential = true`.

## Consequences
- **Positive:** Upload response times remain fast; users can find documents by phrases inside scans and attachments; zero additional external cloud OCR costs; and confidential records remain completely protected.
- **Negative:** Text from scanned PDFs is not searchable instantly upon upload, but becomes available once the asynchronous job finishes.
