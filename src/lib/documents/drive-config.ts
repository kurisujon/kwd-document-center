import { getAdminFolderMappingKey, type AdminCategory } from "./admin-categories";

export class DriveConfigurationError extends Error {}

function loadFolderMap(): Record<string, string> {
  const raw = process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DriveConfigurationError("Admin Drive folder mapping is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DriveConfigurationError("Admin Drive folder mapping is invalid.");
  }
  return parsed as Record<string, string>;
}

export function getAdminDriveFolderId(category: AdminCategory, year: number | null, subcategory: string): string {
  const key = getAdminFolderMappingKey(category, year ?? undefined, subcategory || undefined);
  const mappedFolderId = loadFolderMap()[key];
  if (typeof mappedFolderId === "string" && /^[A-Za-z0-9_-]{10,}$/.test(mappedFolderId)) return mappedFolderId;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (typeof rootFolderId === "string" && /^[A-Za-z0-9_-]{10,}$/.test(rootFolderId)) return rootFolderId;
  throw new DriveConfigurationError(`No valid Drive destination is configured for ${key}.`);
}
