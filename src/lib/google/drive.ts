import "server-only";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { classifyDriveError, DriveServiceError, isDriveFileId, type DriveDeletionService, type DriveFileMetadata, type DriveService } from "./drive-types";
import { trashDriveFile, untrashDriveFile } from "./drive-deletion";
import { createDriveOAuthClient, getDriveOAuthConfig } from "./drive-oauth";
export { DriveServiceError, isDriveFileId } from "./drive-types";
export type { DriveDownload, DriveFileMetadata, DriveService } from "./drive-types";

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

function normalizeMetadata(file: drive_v3.Schema$File): DriveFileMetadata {
  if (!file.id || !file.name || !file.mimeType) throw new DriveServiceError("PROVIDER");
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    trashed: file.trashed === true,
    webViewLink: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
  };
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  return candidate.code === 409 || candidate.response?.status === 409;
}

export function createDriveService(): DriveService & DriveDeletionService {
  let driveClient: drive_v3.Drive | undefined;
  function client() {
    if (!driveClient) {
      const { refreshToken } = getDriveOAuthConfig(true);
      const auth = createDriveOAuthClient();
      auth.setCredentials({ refresh_token: refreshToken });
      driveClient = google.drive({ version: "v3", auth });
    }
    return driveClient;
  }

  async function getMetadata(fileId: string): Promise<DriveFileMetadata> {
    if (!isDriveFileId(fileId)) throw new DriveServiceError("INVALID_ID");
    return withTransientRetry(async () => {
      const response = await client().files.get({
        fileId,
        fields: "id,name,mimeType,trashed,webViewLink,size",
        supportsAllDrives: true,
      });
      const metadata = normalizeMetadata(response.data);
      if (metadata.trashed) throw new DriveServiceError("NOT_FOUND");
      return metadata;
    });
  }

  async function trash(fileId: string) {
    return trashDriveFile(client().files, fileId);
  }

  async function untrash(fileId: string) {
    return untrashDriveFile(client().files, fileId);
  }

  async function recoverCreatedFile(fileId: string): Promise<DriveFileMetadata | null> {
    // Bounded backoff for Drive eventual-consistency after a same-ID 409.
    // Total recovery window is ~2 seconds. Do NOT poll indefinitely.
    const delays = [0, 200, 600, 1200];
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        return await getMetadata(fileId);
      } catch (error) {
        if (!(error instanceof DriveServiceError) || error.kind !== "NOT_FOUND") throw error;
      }
    }
    return null;
  }

  async function createUsingReservedId(input: { fileId: string; folderId: string; name: string; mimeType: string; bytes: Uint8Array; uploadAttemptId: string }): Promise<DriveFileMetadata> {
    const response = await client().files.create({
      // A generated file ID is the Drive-side idempotency anchor. A retry with
      // this ID cannot create a second file.
      requestBody: {
        id: input.fileId,
        name: input.name,
        parents: [input.folderId],
        appProperties: { kwd_upload_attempt_id: input.uploadAttemptId },
      },
      media: { mimeType: input.mimeType, body: Readable.from([Buffer.from(input.bytes)]) },
      uploadType: "resumable",
      fields: "id,name,mimeType,trashed,webViewLink",
      supportsAllDrives: true,
    });
    return normalizeMetadata(response.data);
  }

  return {
    async generateFileId() {
      try {
        const response = await client().files.generateIds({ count: 1, space: "drive", type: "files" });
        const fileId = response.data.ids?.[0];
        if (!fileId || !isDriveFileId(fileId)) throw new DriveServiceError("PROVIDER");
        return fileId;
      } catch (error) {
        throw classifyDriveError(error);
      }
    },
    async upload(input) {
      if (!isDriveFileId(input.fileId)) throw new DriveServiceError("INVALID_ID");
      // Do not use a generic create retry. After an ambiguous response, look up
      // the reserved ID first; only retry with that same ID when it is absent.
      try {
        return await createUsingReservedId(input);
      } catch (error) {
        const classified = classifyDriveError(error);
        if (classified.kind !== "TRANSIENT" && !isConflict(error)) throw classified;
        const recovered = await recoverCreatedFile(input.fileId);
        if (recovered) return recovered;
        if (isConflict(error)) throw new DriveServiceError("AMBIGUOUS");
        try {
          return await createUsingReservedId(input);
        } catch (retryError) {
          const recoveredAfterRetry = await recoverCreatedFile(input.fileId);
          if (recoveredAfterRetry) return recoveredAfterRetry;
          if (classifyDriveError(retryError).kind === "TRANSIENT") throw new DriveServiceError("AMBIGUOUS");
          throw classifyDriveError(retryError);
        }
      }
    },
    getMetadata,
    trash,
    untrash,
    async download(fileId) {
      const metadata = await getMetadata(fileId);
      return withTransientRetry(async () => {
        const response = await client().files.get(
          { fileId, alt: "media", supportsAllDrives: true },
          { responseType: "stream" },
        );
        const sizeHeader = response.headers["content-length"];
        return {
          ...metadata,
          stream: response.data as Readable,
          size: sizeHeader ? Number(sizeHeader) : null,
        };
      });
    },
  };
}
