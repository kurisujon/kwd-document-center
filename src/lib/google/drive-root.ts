import type { drive_v3 } from "googleapis";
import { classifyDriveError, DriveServiceError, isDriveFileId } from "./drive-types";

const ROOT_FOLDER_NAME = "KWD Document Center";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ROOT_FOLDER_DESCRIPTION = "Root repository for Kiblawan Water District Document Center";

export async function ensureRootDriveFolder(drive: drive_v3.Drive): Promise<string> {
  try {
    const existing = await drive.files.list({
      q: `name = '${ROOT_FOLDER_NAME}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false and 'root' in parents`,
      fields: "files(id,name,trashed)",
      spaces: "drive",
      pageSize: 1,
    });
    const existingId = existing.data.files?.[0]?.id;
    if (existingId && isDriveFileId(existingId)) return existingId;

    const created = await drive.files.create({
      requestBody: {
        name: ROOT_FOLDER_NAME,
        mimeType: FOLDER_MIME_TYPE,
        description: ROOT_FOLDER_DESCRIPTION,
      },
      fields: "id,name,trashed",
    });
    const createdId = created.data.id;
    if (!createdId || !isDriveFileId(createdId)) throw new DriveServiceError("PROVIDER");
    return createdId;
  } catch (error) {
    if (error instanceof DriveServiceError) throw error;
    throw classifyDriveError(error);
  }
}

export { FOLDER_MIME_TYPE, ROOT_FOLDER_DESCRIPTION, ROOT_FOLDER_NAME };
