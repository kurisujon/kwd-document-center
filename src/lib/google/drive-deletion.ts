import type { drive_v3 } from "googleapis";
import { classifyDriveError, DriveServiceError, isDriveFileId, type DriveTrashResult, type DriveUntrashResult } from "./drive-types";

type DriveFiles = Pick<drive_v3.Resource$Files, "get" | "update">;

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: DriveServiceError | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = classifyDriveError(error);
      if (lastError.kind !== "TRANSIENT" || attempt === 1) throw lastError;
    }
  }
  throw lastError ?? new DriveServiceError("PROVIDER");
}

/** Server-side, registry-owned Drive Trash operation. */
export async function trashDriveFile(files: DriveFiles, fileId: string): Promise<DriveTrashResult> {
  if (!isDriveFileId(fileId)) throw new DriveServiceError("INVALID_ID");
  try {
    const response = await withTransientRetry(async () => files.update({
      fileId,
      requestBody: { trashed: true },
      fields: "id,trashed",
      supportsAllDrives: true,
    }));
    if (response.data.id !== fileId || response.data.trashed !== true) throw new DriveServiceError("PROVIDER");
    return { disposition: "TRASHED" };
  } catch (error) {
    const classified = classifyDriveError(error);
    if (classified.kind === "NOT_FOUND") return { disposition: "ABSENT" };
    if (classified.kind === "TRANSIENT") {
      try {
        const response = await files.get({ fileId, fields: "id,trashed", supportsAllDrives: true });
        if (response.data.id === fileId && response.data.trashed === true) return { disposition: "TRASHED" };
      } catch (verificationError) {
        if (classifyDriveError(verificationError).kind === "NOT_FOUND") return { disposition: "ABSENT" };
      }
    }
    throw classified;
  }
}

/** Server-side Drive untrash operation for restoring legacy soft-deleted records that were trashed in Drive before ADR-006. */
export async function untrashDriveFile(files: DriveFiles, fileId: string): Promise<DriveUntrashResult> {
  if (!isDriveFileId(fileId)) throw new DriveServiceError("INVALID_ID");
  try {
    const response = await withTransientRetry(async () => files.update({
      fileId,
      requestBody: { trashed: false },
      fields: "id,trashed",
      supportsAllDrives: true,
    }));
    if (response.data.id !== fileId || response.data.trashed !== false) throw new DriveServiceError("PROVIDER");
    return { disposition: "UNTRASHED" };
  } catch (error) {
    const classified = classifyDriveError(error);
    if (classified.kind === "NOT_FOUND") return { disposition: "ABSENT" };
    throw classified;
  }
}
