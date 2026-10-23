import type { BatchUploadStatus } from "./batch-upload-types";

export type FolderBulkMetadataField = "subject" | "document_date" | "persons_involved";
export type FolderBulkMetadataValues = Pick<Record<FolderBulkMetadataField, string>, FolderBulkMetadataField>;

export type FolderBulkItem = {
  localId: string;
  attempted: boolean;
  status: BatchUploadStatus;
  metadata: { subject: string; document_date: string; persons_involved: string };
};

export function isFolderBulkEditable(item: Pick<FolderBulkItem, "attempted" | "status">) {
  return !item.attempted && (item.status === "READY" || item.status === "NEEDS_METADATA");
}

export function isValidFolderBulkDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateFolderBulkValues(fields: ReadonlySet<FolderBulkMetadataField>, values: FolderBulkMetadataValues, action: "APPLY" | "CLEAR"): string | undefined {
  if (!fields.size) return "Choose at least one metadata field.";
  if (action === "CLEAR") return undefined;
  if (fields.has("subject") && (!values.subject.trim() || values.subject.trim().length > 500)) return "Subject is required and must not exceed 500 characters.";
  if (fields.has("document_date") && !isValidFolderBulkDate(values.document_date)) return "Document date must use a valid YYYY-MM-DD value.";
  if (fields.has("persons_involved") && (!values.persons_involved.trim() || values.persons_involved.trim().length > 500)) return "Persons involved must not exceed 500 characters.";
  return undefined;
}

export function selectedFolderBulkIds(items: readonly FolderBulkItem[], selected: ReadonlySet<string>) {
  return new Set(items.filter((item) => selected.has(item.localId) && isFolderBulkEditable(item)).map((item) => item.localId));
}
