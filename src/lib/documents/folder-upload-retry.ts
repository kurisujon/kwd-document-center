export type FolderUploadRetryDisposition = "RETRYABLE" | "BLOCKED" | "NEEDS_ATTENTION" | "AUTH_ATTENTION";

export type FolderUploadRetryState = {
  disposition: FolderUploadRetryDisposition;
  message: string;
};

type FolderUploadRequestFailure = {
  status?: number;
  code?: string;
};

export function classifyFolderUploadFailure(failure: FolderUploadRequestFailure | undefined): FolderUploadRetryState {
  if (!failure || failure.status === undefined || failure.status >= 500 || failure.status === 429) {
    return { disposition: "RETRYABLE", message: "Upload could not be confirmed. You can safely retry this file." };
  }
  if (failure.status === 409 && failure.code === "UPLOAD_IN_PROGRESS") {
    return { disposition: "RETRYABLE", message: "This upload is still being processed. Check again shortly." };
  }
  if (failure.status === 409) {
    return { disposition: "BLOCKED", message: "This upload conflicts with an existing folder upload and cannot be retried." };
  }
  if (failure.status === 401 || failure.status === 403) {
    return { disposition: "AUTH_ATTENTION", message: "Your session or permissions need attention before continuing." };
  }
  return { disposition: "NEEDS_ATTENTION", message: "This upload needs attention before it can be retried." };
}

export function isFolderUploadRetryable(disposition: FolderUploadRetryDisposition | undefined): boolean {
  return disposition === "RETRYABLE";
}
