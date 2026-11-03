/**
 * XHR Upload Transport with fine-grained byte progress and separate Processing state.
 */

import type { DocumentRecord } from "./types";
import type { BatchUploadMetadata } from "./batch-upload-types";

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadTransportResult {
  document: DocumentRecord;
  reused: boolean;
}

export class UploadTransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly actionUrl?: string,
    readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "UploadTransportError";
  }

  get isAborted(): boolean {
    return this.code === "ABORTED";
  }

  get isNetworkError(): boolean {
    return this.code === "NETWORK_ERROR" || this.code === "TIMEOUT_ERROR";
  }

  get isAuthExpired(): boolean {
    return this.status === 401 || this.code === "UNAUTHORIZED";
  }

  get isGoogleAuthExpired(): boolean {
    return this.code === "DRIVE_AUTH_EXPIRED" || (this.code === "DRIVE_ERROR" && this.status === 502);
  }
}

export interface UploadTransportOptions {
  file: File;
  metadata: BatchUploadMetadata;
  idempotencyKey: string;
  url?: string;
  targetFolderId?: string;
  sourceRelativePath?: string;
  onProgress?: (progress: UploadProgress) => void;
  onProcessing?: () => void;
  signal?: AbortSignal;
}

export interface ActiveUploadHandle {
  abort: () => void;
  promise: Promise<UploadTransportResult>;
}

export function startDocumentUpload(options: UploadTransportOptions): ActiveUploadHandle {
  const {
    file,
    metadata,
    idempotencyKey,
    url = "/api/documents",
    targetFolderId,
    sourceRelativePath,
    onProgress,
    onProcessing,
    signal,
  } = options;

  let xhr: XMLHttpRequest | null = new XMLHttpRequest();
  let aborted = false;
  let isProcessing = false;

  const abort = () => {
    if (!aborted && xhr) {
      aborted = true;
      xhr.abort();
    }
  };

  const promise = new Promise<UploadTransportResult>((resolve, reject) => {
    if (signal?.aborted) {
      aborted = true;
      reject(new UploadTransportError("Upload was cancelled.", 0, "ABORTED"));
      return;
    }

    const onSignalAbort = () => {
      abort();
    };

    signal?.addEventListener("abort", onSignalAbort, { once: true });

    xhr!.open("POST", url, true);

    if (xhr!.upload) {
      xhr!.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress?.({ loaded: event.loaded, total: event.total, percent });
          if (event.loaded >= event.total) {
            isProcessing = true;
            onProcessing?.();
          }
        }
      };
    }

    xhr!.onload = () => {
      signal?.removeEventListener("abort", onSignalAbort);
      const activeXhr = xhr;
      xhr = null;

      if (!activeXhr) return;

      let body: { document?: DocumentRecord; reused?: boolean; error?: { code?: string; message?: string; actionUrl?: string } } = {};
      try {
        body = JSON.parse(activeXhr.responseText || "{}");
      } catch {
        // Non-JSON response
      }

      if (activeXhr.status >= 200 && activeXhr.status < 300 && body.document?.document_id) {
        resolve({
          document: body.document,
          reused: Boolean(body.reused),
        });
      } else {
        const code = body.error?.code ?? "UPLOAD_ERROR";
        const message = body.error?.message ?? `The document could not be uploaded (HTTP ${activeXhr.status}).`;
        const actionUrl = body.error?.actionUrl;
        reject(new UploadTransportError(message, activeXhr.status, code, actionUrl, body));
      }
    };

    xhr!.onerror = () => {
      signal?.removeEventListener("abort", onSignalAbort);
      xhr = null;
      if (isProcessing) {
        reject(
          new UploadTransportError(
            "Connection was lost while saving. Please retry to confirm whether the document was saved.",
            0,
            "NETWORK_ERROR",
          ),
        );
      } else {
        reject(
          new UploadTransportError(
            "Network connection was interrupted. Please retry.",
            0,
            "NETWORK_ERROR",
          ),
        );
      }
    };

    xhr!.ontimeout = () => {
      signal?.removeEventListener("abort", onSignalAbort);
      xhr = null;
      if (isProcessing) {
        reject(
          new UploadTransportError(
            "Taking longer than expected. Retry is safe.",
            0,
            "PROCESSING_TIMEOUT",
          ),
        );
      } else {
        reject(
          new UploadTransportError(
            "Upload request timed out. Please retry.",
            0,
            "TIMEOUT_ERROR",
          ),
        );
      }
    };

    xhr!.onabort = () => {
      signal?.removeEventListener("abort", onSignalAbort);
      xhr = null;
      reject(new UploadTransportError("Upload was cancelled.", 0, "ABORTED"));
    };

    const formData = new FormData();
    formData.set("document_type", metadata.document_type);
    formData.set("filing_year", metadata.filing_year === null ? "" : String(metadata.filing_year));
    formData.set("filing_subcategory", metadata.filing_subcategory ?? "");
    formData.set("document_number", metadata.document_number ?? "");
    formData.set("document_date", metadata.document_date ?? "");
    formData.set("subject", metadata.subject ?? "");
    formData.set("persons_involved", metadata.persons_involved ?? "");
    formData.set("idempotency_key", idempotencyKey);
    formData.set("file", file, file.name);

    if (targetFolderId && sourceRelativePath) {
      formData.set("target_folder_id", targetFolderId);
      formData.set("source_relative_path", sourceRelativePath);
    }

    try {
      xhr!.send(formData);
    } catch {
      signal?.removeEventListener("abort", onSignalAbort);
      xhr = null;
      reject(new UploadTransportError("Could not initiate upload request.", 0, "NETWORK_ERROR"));
    }
  });

  return { abort, promise };
}
