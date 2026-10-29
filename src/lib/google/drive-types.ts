import type { Readable } from "node:stream";

export type DriveErrorKind = "INVALID_ID" | "NOT_FOUND" | "FORBIDDEN" | "TRANSIENT" | "AMBIGUOUS" | "PROVIDER";

export class DriveServiceError extends Error {
  readonly kind: DriveErrorKind;

  constructor(kind: DriveErrorKind) {
    super("Google Drive operation failed.");
    this.kind = kind;
  }
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  webViewLink: string;
}

export interface DriveDownload extends DriveFileMetadata {
  stream: Readable;
  size: number | null;
}

export type DriveTrashResult = { disposition: "TRASHED" } | { disposition: "ABSENT" };
export type DriveUntrashResult = { disposition: "UNTRASHED" } | { disposition: "ABSENT" };

export interface DriveDeletionService {
  trash(fileId: string): Promise<DriveTrashResult>;
  untrash?(fileId: string): Promise<DriveUntrashResult>;
}

export interface DriveService {
  generateFileId(): Promise<string>;
  upload(input: { fileId: string; folderId: string; name: string; mimeType: string; bytes: Uint8Array; uploadAttemptId: string }): Promise<DriveFileMetadata>;
  getMetadata(fileId: string): Promise<DriveFileMetadata>;
  download(fileId: string): Promise<DriveDownload>;
}

export function isDriveFileId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}

export function classifyDriveError(error: unknown): DriveServiceError {
  if (error instanceof DriveServiceError) return error;
  if (!error || typeof error !== "object") return new DriveServiceError("PROVIDER");
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  const statusValue = candidate.response?.status ?? candidate.code;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  if (status === 404) return new DriveServiceError("NOT_FOUND");
  if (status === 401 || status === 403) return new DriveServiceError("FORBIDDEN");
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return new DriveServiceError("TRANSIENT");
  const code = String(candidate.code ?? "");
  if (["ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN"].includes(code)) return new DriveServiceError("TRANSIENT");
  return new DriveServiceError("PROVIDER");
}
