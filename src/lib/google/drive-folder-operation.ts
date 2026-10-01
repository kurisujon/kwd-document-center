import type { drive_v3 } from "googleapis";
import { classifyDriveError, DriveServiceError, isDriveFileId } from "./drive-types";

export type DriveFolderMetadata = { id: string; name: string; parents: string[]; mimeType: string; trashed: boolean };
type FolderFiles = Pick<drive_v3.Resource$Files, "get" | "create">;

function normalize(data: drive_v3.Schema$File): DriveFolderMetadata {
  if (!data.id || !data.name || !data.mimeType || !Array.isArray(data.parents)) throw new DriveServiceError("PROVIDER");
  return { id: data.id, name: data.name, parents: data.parents, mimeType: data.mimeType, trashed: data.trashed === true };
}

export async function getReservedFolder(files: FolderFiles, folderId: string): Promise<DriveFolderMetadata | null> {
  if (!isDriveFileId(folderId)) throw new DriveServiceError("INVALID_ID");
  try { return normalize((await files.get({ fileId: folderId, fields: "id,name,parents,mimeType,trashed", supportsAllDrives: true })).data); }
  catch (error) { if (classifyDriveError(error).kind === "NOT_FOUND") return null; throw classifyDriveError(error); }
}

export async function createReservedFolder(files: FolderFiles, input: { id: string; parentId: string; name: string }): Promise<DriveFolderMetadata> {
  if (!isDriveFileId(input.id) || !isDriveFileId(input.parentId)) throw new DriveServiceError("INVALID_ID");
  try {
    return normalize((await files.create({ requestBody: { id: input.id, name: input.name, mimeType: "application/vnd.google-apps.folder", parents: [input.parentId] }, fields: "id,name,parents,mimeType,trashed", supportsAllDrives: true })).data);
  } catch (error) {
    const classified = classifyDriveError(error);
    if (classified.kind === "TRANSIENT") {
      const existing = await getReservedFolder(files, input.id);
      if (existing) return existing;
    }
    throw classified;
  }
}
