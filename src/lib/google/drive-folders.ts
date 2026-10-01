import "server-only";
import { google, type drive_v3 } from "googleapis";
import { classifyDriveError, DriveServiceError, isDriveFileId } from "./drive-types";
import { createReservedFolder, getReservedFolder, type DriveFolderMetadata } from "./drive-folder-operation";
import { createDriveOAuthClient, getDriveOAuthConfig } from "./drive-oauth";

export type { DriveFolderMetadata } from "./drive-folder-operation";

export function createDriveFolderService() {
  let client: drive_v3.Drive | undefined;
  function drive() {
    if (!client) {
      const { refreshToken } = getDriveOAuthConfig(true);
      const auth = createDriveOAuthClient();
      auth.setCredentials({ refresh_token: refreshToken });
      client = google.drive({ version: "v3", auth });
    }
    return client;
  }

  return {
    async generateId(): Promise<string> {
      try {
        const response = await drive().files.generateIds({ count: 1, space: "drive", type: "files" });
        const id = response.data.ids?.[0];
        if (!id || !isDriveFileId(id)) throw new DriveServiceError("PROVIDER");
        return id;
      } catch (error) { throw classifyDriveError(error); }
    },
    async get(folderId: string): Promise<DriveFolderMetadata | null> {
      return getReservedFolder(drive().files, folderId);
    },
    async create(input: { id: string; parentId: string; name: string }): Promise<DriveFolderMetadata> {
      return createReservedFolder(drive().files, input);
    },
  };
}

export type DriveFolderService = ReturnType<typeof createDriveFolderService>;
