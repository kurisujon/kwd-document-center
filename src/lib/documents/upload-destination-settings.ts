import type { HierarchyFolderRecord } from "./hierarchy-repository";
import { validateUploadDestinationRecord } from "./upload-destination";

const uploadableKinds = ["CATEGORY", "SUBCATEGORY", "WORKING_FOLDER"] as const;
type UploadableKind = (typeof uploadableKinds)[number];

export type UploadDestinationSetting = {
  destinationId: string;
  hierarchyKind: UploadableKind;
  filingYear: number;
  category: string;
  subcategory: string | null;
  displayName: string;
  uploadEnabled: boolean;
};

export type UploadDestinationSettingsRepository = {
  listActiveHierarchyFolders(options: { departmentKey: string; kinds: UploadableKind[] }): Promise<HierarchyFolderRecord[]>;
  setHierarchyUploadEnabled(input: { folderId: string; uploadEnabled: boolean }): Promise<HierarchyFolderRecord | null>;
};

function toSetting(record: HierarchyFolderRecord): UploadDestinationSetting {
  const destination = validateUploadDestinationRecord(record, { requireUploadEnabled: false, requireDriveFolderId: true });
  const parts = [String(destination.filingYear), destination.category, destination.subcategory];
  if (destination.hierarchyKind === "WORKING_FOLDER") parts.push(record.name);
  return {
    destinationId: destination.folderId,
    hierarchyKind: destination.hierarchyKind,
    filingYear: destination.filingYear,
    category: destination.category,
    subcategory: destination.subcategory,
    displayName: parts.filter(Boolean).join(" / "),
    uploadEnabled: record.uploadEnabled,
  };
}

function compareSettings(left: UploadDestinationSetting, right: UploadDestinationSetting) {
  return right.filingYear - left.filingYear
    || left.category.localeCompare(right.category)
    || (left.subcategory ?? "").localeCompare(right.subcategory ?? "")
    || left.displayName.localeCompare(right.displayName)
    || left.destinationId.localeCompare(right.destinationId);
}

export async function listUploadDestinationSettings(repository: UploadDestinationSettingsRepository): Promise<UploadDestinationSetting[]> {
  const records = await repository.listActiveHierarchyFolders({ departmentKey: "ADMIN", kinds: [...uploadableKinds] });
  return records.flatMap((record) => {
    try { return [toSetting(record)]; }
    catch { return []; }
  }).sort(compareSettings);
}

export async function setUploadDestinationEnabled(folderId: string, uploadEnabled: boolean, repository: UploadDestinationSettingsRepository): Promise<UploadDestinationSetting | null> {
  const record = await repository.setHierarchyUploadEnabled({ folderId, uploadEnabled });
  if (!record) return null;
  try { return toSetting(record); }
  catch { return null; }
}
