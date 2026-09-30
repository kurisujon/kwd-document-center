import { adminUploadFormats, type AdminUploadExtension } from "./upload-formats";
import { adminSubcategories, categoryUsesYear } from "./admin-categories";
import type { AdminDocumentMetadata } from "./upload-types";

export const maximumBatchUploadFiles = 25;
export const batchUploadConcurrency = 3;

export function canSelectBatchFiles(existingCount: number, incomingCount: number): boolean {
  return Number.isSafeInteger(existingCount) && Number.isSafeInteger(incomingCount)
    && existingCount >= 0 && incomingCount >= 0 && existingCount + incomingCount <= maximumBatchUploadFiles;
}

export type BatchUploadStatus = "QUEUED" | "NEEDS_METADATA" | "READY" | "UPLOADING" | "UPLOADED" | "FAILED" | "INVALID_FILE" | "CANCELLED";

export type BatchUploadItem = {
  localId: string;
  file: File;
  relativePath?: string;
  idempotencyKey: string;
  metadata: AdminDocumentMetadata;
  suggestedSubject: string;
  status: BatchUploadStatus;
  error?: string;
  documentId?: string;
};

export type BatchUploadDefaults = Pick<AdminDocumentMetadata, "document_type" | "filing_year" | "filing_subcategory" | "document_date" | "persons_involved">;

export function isBatchItemEditable(item: Pick<BatchUploadItem, "status">): boolean {
  return ["QUEUED", "NEEDS_METADATA", "READY", "INVALID_FILE"].includes(item.status);
}

function extensionFor(name: string): AdminUploadExtension | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 1) return undefined;
  const extension = name.slice(dot).toLowerCase() as AdminUploadExtension;
  return extension in adminUploadFormats ? extension : undefined;
}

function isCompatibleBrowserMime(file: File, extension: AdminUploadExtension): boolean {
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  if (!declared) return true;
  const format = adminUploadFormats[extension];
  if (declared === format.mimeType || ("compatibleMimeTypes" in format && format.compatibleMimeTypes.some((mime) => mime === declared))) return true;
  return format.content !== "text" && declared === "application/octet-stream";
}

export function subjectSuggestion(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return fileName.slice(0, dot > 0 ? dot : fileName.length).replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Browser-only preflight. The server remains the authoritative file validator. */
export function batchFilePreflight(file: File, maxBytes = 4 * 1024 * 1024): string | undefined {
  const extension = extensionFor(file.name);
  if (!extension) return "This file type is not supported.";
  if (file.size < 1) return "Select a non-empty file.";
  if (file.size > maxBytes) return `The file must not exceed ${Math.floor(maxBytes / 1024 / 1024)} MiB.`;
  if (!isCompatibleBrowserMime(file, extension)) return "The selected file has inconsistent type information.";
  return undefined;
}

export function deriveBatchItemStatus(item: Pick<BatchUploadItem, "file" | "metadata">, maxBytes = 4 * 1024 * 1024): Extract<BatchUploadStatus, "READY" | "NEEDS_METADATA" | "INVALID_FILE"> {
  if (batchFilePreflight(item.file, maxBytes)) return "INVALID_FILE";
  if (!item.metadata.document_date || !item.metadata.subject || item.metadata.subject.length > 500) return "NEEDS_METADATA";
  if (categoryUsesYear(item.metadata.document_type) && item.metadata.filing_year === null) return "NEEDS_METADATA";
  const subcategories = adminSubcategories[item.metadata.document_type];
  if (subcategories && !subcategories.includes(item.metadata.filing_subcategory)) return "NEEDS_METADATA";
  return "READY";
}

export function createBatchUploadItem(file: File, defaults: BatchUploadDefaults, idempotencyKey = crypto.randomUUID(), maxBytes = 4 * 1024 * 1024): BatchUploadItem {
  const metadata: AdminDocumentMetadata = {
    document_type: defaults.document_type,
    filing_year: defaults.filing_year,
    filing_subcategory: defaults.filing_subcategory,
    document_number: "",
    document_date: defaults.document_date,
    subject: "",
    persons_involved: defaults.persons_involved,
  };
  const item: BatchUploadItem = {
    localId: crypto.randomUUID(),
    file,
    idempotencyKey,
    metadata,
    suggestedSubject: subjectSuggestion(file.name),
    status: "QUEUED",
  };
  const error = batchFilePreflight(file, maxBytes);
  return { ...item, status: error ? "INVALID_FILE" : deriveBatchItemStatus(item, maxBytes), ...(error ? { error } : {}) };
}

export function refreshBatchItem(item: BatchUploadItem, maxBytes = 4 * 1024 * 1024): BatchUploadItem {
  if (!isBatchItemEditable(item)) return item;
  const error = batchFilePreflight(item.file, maxBytes);
  return { ...item, status: error ? "INVALID_FILE" : deriveBatchItemStatus(item, maxBytes), ...(error ? { error } : { error: undefined }) };
}

export function appendBatchFiles(items: readonly BatchUploadItem[], files: readonly File[], defaults: BatchUploadDefaults, maxBytes = 4 * 1024 * 1024, createItem = createBatchUploadItem): { items: BatchUploadItem[]; error?: string } {
  if (!canSelectBatchFiles(items.length, files.length)) return { items: [...items], error: `Select no more than ${maximumBatchUploadFiles} files in one batch.` };
  return { items: [...items, ...files.map((file) => createItem(file, defaults, crypto.randomUUID(), maxBytes))] };
}

export function updateBatchItem(items: readonly BatchUploadItem[], localId: string, change: (item: BatchUploadItem) => BatchUploadItem, maxBytes = 4 * 1024 * 1024): BatchUploadItem[] {
  return items.map((item) => item.localId === localId ? refreshBatchItem(change(item), maxBytes) : item);
}

export function applyToSelectedBatchItems(items: readonly BatchUploadItem[], selected: ReadonlySet<string>, change: (item: BatchUploadItem) => BatchUploadItem, maxBytes = 4 * 1024 * 1024): BatchUploadItem[] {
  return items.map((item) => selected.has(item.localId) && isBatchItemEditable(item) ? refreshBatchItem(change(item), maxBytes) : item);
}

export function selectAllEditableBatchItems(items: readonly BatchUploadItem[]): Set<string> {
  return new Set(items.filter(isBatchItemEditable).map((item) => item.localId));
}

export function removeEditableBatchItem(items: readonly BatchUploadItem[], selected: ReadonlySet<string>, localId: string): { items: BatchUploadItem[]; selected: Set<string> } {
  const item = items.find((candidate) => candidate.localId === localId);
  if (!item || !isBatchItemEditable(item)) return { items: [...items], selected: new Set(selected) };
  const nextSelected = new Set(selected);
  nextSelected.delete(localId);
  return { items: items.filter((candidate) => candidate.localId !== localId), selected: nextSelected };
}

export function retryFailedBatchItems(items: readonly BatchUploadItem[], maxBytes = 4 * 1024 * 1024): BatchUploadItem[] {
  return items.map((item) => item.status === "FAILED" ? { ...item, status: deriveBatchItemStatus(item, maxBytes), error: undefined } : item);
}

export function prepareFailedBatchRetry(items: readonly BatchUploadItem[], maxBytes = 4 * 1024 * 1024): { items: BatchUploadItem[]; candidates: BatchUploadItem[] } {
  const failedIds = new Set(items.filter((item) => item.status === "FAILED").map((item) => item.localId));
  const nextItems = retryFailedBatchItems(items, maxBytes);
  return { items: nextItems, candidates: nextItems.filter((item) => failedIds.has(item.localId)) };
}
