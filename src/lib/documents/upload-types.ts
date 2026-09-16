import type { AdminCategory } from "./admin-categories";
import type { DocumentRecord } from "./types";

export interface AdminDocumentMetadata {
  document_type: AdminCategory;
  document_number: string;
  document_date: string;
  subject: string;
  persons_involved: string;
  filing_year: number | null;
  filing_subcategory: string;
}

export interface ValidatedAdminUpload {
  idempotencyKey: string;
  metadata: AdminDocumentMetadata;
  file: {
    name: string;
    mimeType: string;
    size: number;
    bytes: Uint8Array;
  };
}

export interface UploadMetadataSnapshot extends AdminDocumentMetadata {
  file_name: string;
  file_type: string;
  file_size: number;
}

export type UploadAttemptStatus = "PENDING_UPLOAD" | "UPLOADING" | "PENDING_REGISTRY" | "COMPLETE" | "FAILED";

export interface UploadAttempt {
  id: string;
  idempotency_key: string;
  status: UploadAttemptStatus;
  drive_file_id: string | null;
  operation_token: string | null;
  reservation_expires_at: string | null;
  metadata_snapshot: UploadMetadataSnapshot;
  document_id: string | null;
  created_by: string;
  safe_error_code: string | null;
}

export interface UploadResult {
  document: DocumentRecord;
  created: boolean;
}
