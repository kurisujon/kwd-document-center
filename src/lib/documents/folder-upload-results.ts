import type { BatchUploadStatus } from "./batch-upload-types";
import type { FolderUploadResultsCsvRow } from "./folder-upload-csv";

export type FolderUploadResultState = {
  sourceRelativePath: string;
  fileName: string;
  status: BatchUploadStatus;
  retryDisposition?: "RETRYABLE" | "BLOCKED" | "NEEDS_ATTENTION" | "AUTH_ATTENTION";
  metadata: Pick<FolderUploadResultsCsvRow, "document_number" | "subject" | "document_date" | "persons_involved">;
};

function safeError(state: Pick<FolderUploadResultState, "status" | "retryDisposition">): Pick<FolderUploadResultsCsvRow, "safe_error_code" | "safe_error_message"> {
  if (state.status === "IN_PROGRESS") return { safe_error_code: "UPLOAD_STILL_PROCESSING", safe_error_message: "This upload is still being processed. Check again shortly." };
  if (state.status === "INVALID_FILE") return { safe_error_code: "INVALID_FILE", safe_error_message: "This file needs correction before it can be uploaded." };
  if (state.status === "NEEDS_METADATA") return { safe_error_code: "NEEDS_METADATA", safe_error_message: "Required metadata is incomplete." };
  if (state.status === "FAILED") {
    if (state.retryDisposition === "RETRYABLE") return { safe_error_code: "RETRY_AVAILABLE", safe_error_message: "Upload could not be confirmed. You can safely retry this file." };
    if (state.retryDisposition === "BLOCKED") return { safe_error_code: "CONFLICT", safe_error_message: "This upload conflicts with an existing folder upload and cannot be retried." };
    if (state.retryDisposition === "AUTH_ATTENTION") return { safe_error_code: "AUTHORIZATION_REQUIRED", safe_error_message: "Your session or permissions need attention before continuing." };
    return { safe_error_code: "NEEDS_ATTENTION", safe_error_message: "This upload needs attention before it can be retried." };
  }
  return { safe_error_code: "", safe_error_message: "" };
}

/** Maps only known client state to bounded report values. */
export function toFolderUploadResultsCsvRow(state: FolderUploadResultState): FolderUploadResultsCsvRow {
  return { relative_path: state.sourceRelativePath, filename: state.fileName, ...state.metadata, status: state.status, ...safeError(state) };
}
