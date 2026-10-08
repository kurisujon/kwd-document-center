"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBatchUploadItem, deriveBatchItemStatus, batchUploadConcurrency, type BatchUploadItem, type BatchUploadStatus } from "@/lib/documents/batch-upload-types";
import { createBatchUploadRunGuard, runBatchUploadQueue } from "@/lib/documents/batch-upload-queue";
import { parseFolderSelection, type FolderSelectionIssue, type FolderSelectionIssueCode } from "@/lib/documents/folder-upload-validation";
import { classifyFolderUploadFailure, isFolderUploadRetryable, type FolderUploadRetryDisposition } from "@/lib/documents/folder-upload-retry";
import { FolderUploadCsvError, buildFolderUploadCsvPreview, createFolderUploadCsvTemplate, folderUploadCsvMaxBytes, parseFolderUploadCsv, type FolderUploadCsvPreview } from "@/lib/documents/folder-upload-csv";
import { adminUploadAccept } from "@/lib/documents/upload-formats";

type Destination = { destinationId: string; kind: "CATEGORY" | "SUBCATEGORY" | "WORKING_FOLDER"; filingYear: number; category: string; subcategory: string | null; label: string };
type FolderItem = BatchUploadItem & { sourceRelativePath: string; sourcePathInput: string; attempted: boolean; retryDisposition?: FolderUploadRetryDisposition; recheckAvailableAt?: number };
export const folderUploadRecheckCooldownMs = 500;
export type FolderUploadBatchCounts = {
  total: number;
  ready: number;
  queued: number;
  uploading: number;
  inProgress: number;
  uploaded: number;
  failed: number;
  retryableFailures: number;
  blockedFailures: number;
  invalid: number;
  needsMetadata: number;
};

export function isFolderWorkflowLocked(items: readonly Pick<FolderItem, "attempted">[]) {
  return items.some((item) => item.attempted);
}

export function areAllFolderItemsReady(items: readonly Pick<FolderItem, "status">[]) {
  return items.length > 0 && items.every((item) => item.status === "READY");
}

type FolderUploadBatchItemState = Pick<BatchUploadItem, "status"> & { retryDisposition?: FolderUploadRetryDisposition };

export function getFolderUploadBatchCounts(items: readonly FolderUploadBatchItemState[]): FolderUploadBatchCounts {
  const counts: FolderUploadBatchCounts = { total: items.length, ready: 0, queued: 0, uploading: 0, inProgress: 0, uploaded: 0, failed: 0, retryableFailures: 0, blockedFailures: 0, invalid: 0, needsMetadata: 0 };
  for (const item of items) {
    if (item.status === "READY") counts.ready += 1;
    else if (item.status === "QUEUED") counts.queued += 1;
    else if (item.status === "UPLOADING") counts.uploading += 1;
    else if (item.status === "IN_PROGRESS") counts.inProgress += 1;
    else if (item.status === "UPLOADED") counts.uploaded += 1;
    else if (item.status === "FAILED") {
      counts.failed += 1;
      if (isFolderUploadRetryable(item.retryDisposition)) counts.retryableFailures += 1;
      else counts.blockedFailures += 1;
    }
    else if (item.status === "INVALID_FILE") counts.invalid += 1;
    else if (item.status === "NEEDS_METADATA") counts.needsMetadata += 1;
  }
  return counts;
}

function statusLabel(status: BatchUploadStatus) {
  return ({ QUEUED: "Queued", NEEDS_METADATA: "Needs metadata", READY: "Ready", UPLOADING: "Uploading", IN_PROGRESS: "In progress", UPLOADED: "Uploaded", FAILED: "Failed", INVALID_FILE: "Invalid file", CANCELLED: "Cancelled" })[status];
}

function issueMessage(issue: FolderSelectionIssue | undefined) {
  const messages: Partial<Record<FolderSelectionIssueCode, string>> = { UNSUPPORTED_TYPE: "Unsupported file type.", FILE_TOO_LARGE: "File exceeds 4 MiB.", DUPLICATE_PATH: "Duplicate or colliding relative path.", MIXED_ROOTS: "Select one folder at a time.", PATH_TOO_DEEP: "Path exceeds the allowed directory depth.", PATH_TOO_LONG: "Path is too long.", SEGMENT_TOO_LONG: "A path segment is too long.", PATH_TRAVERSAL: "Path traversal is not allowed.", ABSOLUTE_PATH: "Absolute paths are not allowed.", CONTROL_CHARACTER: "Path contains unsupported characters.", INVALID_PATH: "Relative path is invalid.", EMPTY_FILE: "Select a non-empty file.", INCONSISTENT_FILE_TYPE: "The file type is inconsistent.", TOO_MANY_FILES: "Select no more than 25 files.", TOTAL_SIZE_EXCEEDED: "Selected files exceed the total size limit.", TOO_MANY_DIRECTORIES: "Selected files exceed the directory limit.", NO_FILES_SELECTED: "Select one folder at a time." };
  return messages[issue?.code ?? "INVALID_PATH"] ?? "File selection is invalid.";
}

function destinationMetadata(destination: Destination) {
  return { document_type: destination.category as FolderItem["metadata"]["document_type"], filing_year: destination.filingYear, filing_subcategory: destination.subcategory ?? "", document_date: "", persons_involved: "" };
}

const csvFieldLabels = { document_number: "Document number", subject: "Subject", document_date: "Document date", persons_involved: "Persons involved" } as const;

class FolderUploadRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("Folder upload request failed.");
  }
}

export function FolderUploadReview({ maxBytes, onWorkflowLockChange }: { maxBytes: number; onWorkflowLockChange?: (locked: boolean) => void }) {
  const [destinationState, setDestinationState] = useState<{ status: "LOADING" | "READY" | "ERROR"; values: Destination[] }>({ status: "LOADING", values: [] });
  const [destinationId, setDestinationId] = useState("");
  const [entries, setEntries] = useState<Array<{ file: File; path: string }>>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [manifestError, setManifestError] = useState<string>();
  const [csvPreview, setCsvPreview] = useState<FolderUploadCsvPreview>();
  const [csvFeedback, setCsvFeedback] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [recheckClock, setRecheckClock] = useState(0);
  const guard = useRef(createBatchUploadRunGuard());
  const pickerRef = useRef<HTMLInputElement>(null);
  const csvPickerRef = useRef<HTMLInputElement>(null);
  const destination = destinationState.values.find((value) => value.destinationId === destinationId);
  const attempted = isFolderWorkflowLocked(items);
  const counts = useMemo(() => getFolderUploadBatchCounts(items), [items]);

  useEffect(() => {
    let current = true;
    fetch("/api/folders/upload-destinations").then(async (response) => {
      const body = await response.json().catch(() => ({})) as { destinations?: Destination[] };
      if (!response.ok || !Array.isArray(body.destinations)) throw new Error("unavailable");
      if (current) setDestinationState({ status: "READY", values: body.destinations });
    }).catch(() => { if (current) setDestinationState({ status: "ERROR", values: [] }); });
    return () => { current = false; };
  }, []);

  useEffect(() => { onWorkflowLockChange?.(attempted); }, [attempted, onWorkflowLockChange]);

  useEffect(() => {
    const nextRecheckAt = Math.min(...items.filter((item) => item.status === "IN_PROGRESS" && item.recheckAvailableAt && item.recheckAvailableAt > Date.now()).map((item) => item.recheckAvailableAt!));
    if (!Number.isFinite(nextRecheckAt)) return;
    const timer = window.setTimeout(() => setRecheckClock(Date.now()), Math.max(0, nextRecheckAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [items]);

  function rebuild(nextEntries: Array<{ file: File; path: string }>, selectedDestination = destination, preserveExisting = false) {
    const manifest = parseFolderSelection(nextEntries.map(({ file, path }) => ({ name: file.name, size: file.size, type: file.type, webkitRelativePath: path })));
    setEntries(nextEntries);
    setManifestError(manifest.issues[0] ? issueMessage(manifest.issues[0]) : undefined);
    setCsvPreview(undefined); setCsvFeedback(undefined);
    const defaults = selectedDestination ? destinationMetadata(selectedDestination) : undefined;
    setItems(manifest.files.map((candidate) => {
      const source = nextEntries[candidate.index]!;
      const existing = preserveExisting ? items.find((item) => item.file === source.file && item.sourcePathInput === source.path) : undefined;
      const validationIssue = candidate.issues[0];
      if (existing) {
        const preserved = { ...existing, sourceRelativePath: candidate.relativePath ?? candidate.name, sourcePathInput: source.path };
        if (validationIssue) return { ...preserved, status: "INVALID_FILE" as const, error: issueMessage(validationIssue) };
        return { ...preserved, status: deriveBatchItemStatus(preserved, maxBytes), error: undefined };
      }
      const item = createBatchUploadItem(source.file, defaults ?? { document_type: "BACTI TEST", filing_year: null, filing_subcategory: "", document_date: "", persons_involved: "" }, crypto.randomUUID(), maxBytes);
      return { ...item, sourceRelativePath: candidate.relativePath ?? candidate.name, sourcePathInput: source.path, attempted: false, ...(validationIssue ? { status: "INVALID_FILE" as const, error: issueMessage(validationIssue) } : {}) };
    }));
  }

  function selectFolder(files: FileList | null) {
    if (!files?.length || uploading || attempted) return;
    rebuild(Array.from(files).map((file) => ({ file, path: file.webkitRelativePath })));
  }

  function updateItem(localId: string, change: (item: FolderItem) => FolderItem) {
    setCsvPreview(undefined); setCsvFeedback(undefined);
    setItems((current) => current.map((item) => item.localId === localId && !item.attempted ? (() => { const changed = change(item); return { ...changed, status: deriveBatchItemStatus(changed, maxBytes) }; })() : item));
  }

  function csvItems() {
    return items.map((item) => ({ localId: item.localId, sourceRelativePath: item.sourceRelativePath, metadata: item.metadata }));
  }

  function downloadCsvTemplate() {
    if (attempted || uploading || !items.length) return;
    const blob = new Blob([createFolderUploadCsvTemplate(csvItems())], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "kwd-folder-upload-metadata.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(files: FileList | null) {
    const file = files?.[0];
    if (!file || attempted || uploading) return;
    if (!/\.csv$/i.test(file.name)) { setCsvPreview(undefined); setCsvFeedback("Choose a CSV metadata file."); return; }
    if (file.size > folderUploadCsvMaxBytes) { setCsvPreview(undefined); setCsvFeedback("CSV exceeds the 256 KiB limit."); return; }
    try {
      const rows = parseFolderUploadCsv(new Uint8Array(await file.arrayBuffer()));
      setCsvPreview(buildFolderUploadCsvPreview(rows, csvItems()));
      setCsvFeedback(undefined);
    } catch (error) {
      setCsvPreview(undefined);
      setCsvFeedback(error instanceof FolderUploadCsvError ? error.message : "The CSV could not be imported.");
    } finally {
      if (csvPickerRef.current) csvPickerRef.current.value = "";
    }
  }

  function applyCsvMetadata() {
    if (!csvPreview || attempted || uploading) return;
    const updates = new Map(csvPreview.updates.map((update) => [update.localId, update.values]));
    setItems((current) => current.map((item) => {
      const values = updates.get(item.localId);
      if (!values) return item;
      const changed = { ...item, metadata: { ...item.metadata, ...values } };
      return item.status === "INVALID_FILE" ? changed : { ...changed, status: deriveBatchItemStatus(changed, maxBytes) };
    }));
    setCsvFeedback(`Metadata applied to ${csvPreview.matchedFiles} file${csvPreview.matchedFiles === 1 ? "" : "s"}.`);
    setCsvPreview(undefined);
  }

  async function submitOne(item: BatchUploadItem) {
    const folderItem = item as FolderItem;
    if (!destination) throw new Error("Choose an upload destination.");
    const data = new FormData();
    data.set("document_number", item.metadata.document_number);
    data.set("document_date", item.metadata.document_date);
    data.set("subject", item.metadata.subject);
    data.set("persons_involved", item.metadata.persons_involved);
    data.set("idempotency_key", item.idempotencyKey);
    data.set("target_folder_id", destination.destinationId);
    data.set("source_relative_path", folderItem.sourceRelativePath);
    data.set("file", item.file, item.file.name);
    const response = await fetch("/api/documents", { method: "POST", body: data });
    const body = await response.json().catch(() => ({})) as { document?: { document_id?: string }; error?: { code?: string; message?: string } };
    if (response.status === 202 || (response.status === 409 && body.error?.code === "UPLOAD_IN_PROGRESS")) return { documentId: "", inProgress: true };
    if (!response.ok || !body.document?.document_id) throw new FolderUploadRequestError(response.status, body.error?.code);
    return { documentId: body.document.document_id };
  }

  const allIncludedReady = areAllFolderItemsReady(items);
  const canStartInitialBatch = !attempted && !!destination && !manifestError && allIncludedReady;

  async function startQueue(source: FolderItem[], retry = false) {
    if (uploading || !destination || !source.length || (!retry && !canStartInitialBatch)) return;
    await guard.current.run(async () => {
      setUploading(true);
      try {
        await runBatchUploadQueue({ items: source, concurrency: batchUploadConcurrency, upload: submitOne,
          onQueue: (ids) => {
            const queued = new Set(ids);
            setItems((current) => current.map((item) => queued.has(item.localId) && item.status !== "UPLOADED" ? { ...item, status: "QUEUED", retryDisposition: undefined } : item));
          },
          onStart: (id) => setItems((current) => current.map((item) => item.localId === id ? { ...item, attempted: true, status: "UPLOADING", error: undefined, recheckAvailableAt: undefined } : item)),
          onSuccess: (id, result) => {
            const now = Date.now();
            setRecheckClock(now);
            setItems((current) => current.map((item) => item.localId === id ? { ...item, status: result.inProgress ? "IN_PROGRESS" : "UPLOADED", documentId: result.documentId || undefined, error: result.inProgress ? "This upload is still being processed. Check again shortly." : undefined, retryDisposition: undefined, recheckAvailableAt: result.inProgress ? now + folderUploadRecheckCooldownMs : undefined } : item));
          },
          onFailure: (id, _message, error) => {
            const failure = error instanceof FolderUploadRequestError ? classifyFolderUploadFailure(error) : classifyFolderUploadFailure(undefined);
            setItems((current) => current.map((item) => item.localId === id ? { ...item, status: "FAILED", error: failure.message, retryDisposition: failure.disposition, recheckAvailableAt: undefined } : item));
          },
        });
      } finally { setUploading(false); }
    });
  }

  function retryItems(candidates: FolderItem[]) {
    if (uploading || !candidates.length) return;
    const retry = candidates.map((item) => ({ ...item, status: "READY" as const, error: undefined, retryDisposition: undefined, recheckAvailableAt: undefined }));
    setItems((current) => current.map((item) => retry.find((candidate) => candidate.localId === item.localId) ?? item));
    void startQueue(retry, true);
  }

  function retryOne(item: FolderItem) {
    if (item.status === "FAILED" && isFolderUploadRetryable(item.retryDisposition)) retryItems([item]);
  }

  function checkAgain(item: FolderItem) {
    if (item.status === "IN_PROGRESS" && (!item.recheckAvailableAt || item.recheckAvailableAt <= Date.now())) retryItems([item]);
  }

  const retryableFailures = items.filter((item) => item.status === "FAILED" && isFolderUploadRetryable(item.retryDisposition));
  const unresolved = items.filter((item) => item.status === "IN_PROGRESS");
  const recheckCoolingDown = unresolved.some((item) => item.recheckAvailableAt && item.recheckAvailableAt > recheckClock);

  function removeItem(id: string) {
    if (uploading || attempted) return;
    rebuild(entries.filter((entry, index) => items[index]?.localId !== id), destination, true);
  }

  function discardLocalBatch() {
    if (uploading) return;
    setEntries([]); setItems([]); setManifestError(undefined); setCsvPreview(undefined); setCsvFeedback(undefined); setDestinationId("");
    setResetConfirmationOpen(false);
    if (pickerRef.current) pickerRef.current.value = "";
  }

  function requestReset() {
    if (uploading) return;
    if (unresolved.length) { setResetConfirmationOpen(true); return; }
    discardLocalBatch();
  }

  const directoryCount = parseFolderSelection(entries.map(({ file, path }) => ({ name: file.name, size: file.size, type: file.type, webkitRelativePath: path }))).uniqueDirectoryCount;
  const rootName = entries[0]?.path.split(/[\\/]/)[0] ?? "Selected folder";
  return <section className="batch-upload folder-upload" aria-labelledby="folder-upload-title">
    <div className="section-heading"><h2 id="folder-upload-title">Upload a folder</h2><p>Choose one approved destination. Files retain their local relative path as provenance and upload independently.</p></div>
    <label className="field">Upload destination<select aria-label="Upload destination" value={destinationId} disabled={uploading || attempted || destinationState.status !== "READY"} onChange={(event) => { const selected = destinationState.values.find((value) => value.destinationId === event.target.value); setDestinationId(event.target.value); if (entries.length) rebuild(entries, selected); }}><option value="">Select a destination</option>{destinationState.values.map((value) => <option key={value.destinationId} value={value.destinationId}>{value.label}</option>)}</select></label>
    {destinationState.status === "LOADING" && <p role="status" className="notice">Loading upload destinations…</p>}
    {destinationState.status === "ERROR" && <p role="alert" className="form-error">Upload destinations are temporarily unavailable. Try again later.</p>}
    {destinationState.status === "READY" && !destinationState.values.length && <p className="notice">No upload-enabled folders are available.</p>}
    <label className="field file-field">Folder<input ref={pickerRef} aria-label="Select a folder" type="file" multiple accept={adminUploadAccept} disabled={uploading || attempted} {...({ webkitdirectory: "" } as { webkitdirectory: string })} onChange={(event) => { selectFolder(event.target.files); event.currentTarget.value = ""; }} /><span>Folder selection is supported in Chrome and Edge. Empty folders are not included.</span></label>
    {manifestError && <p className="form-error" role="alert">{manifestError}</p>}
    {items.length > 0 && <>
      <div className="batch-progress" aria-labelledby="folder-upload-progress-summary">
        <progress value={counts.uploaded} max={counts.total} aria-label={`Folder upload progress: ${counts.uploaded} of ${counts.total} uploaded`}>{counts.uploaded} of {counts.total}</progress>
        <p id="folder-upload-progress-summary" className="batch-summary" role="status" aria-live="polite">Folder: {rootName} · {counts.uploaded} of {counts.total} uploaded · Total: {Math.ceil(entries.reduce((total, entry) => total + entry.file.size, 0) / 1024)} KiB · Directories: {directoryCount} · Ready: {counts.ready} · Queued: {counts.queued} · Uploading: {counts.uploading} · In progress: {counts.inProgress} · Failed: {counts.failed} · Retry available: {counts.retryableFailures} · Needs attention: {counts.blockedFailures} · Needs metadata: {counts.needsMetadata} · Invalid: {counts.invalid}</p>
      </div>
      <section className="csv-metadata-actions" aria-labelledby="csv-metadata-title"><h3 id="csv-metadata-title">CSV metadata</h3><p>Download the template, complete metadata in a spreadsheet, then import it for review before applying changes.</p><div className="form-actions"><button className="button button-secondary" type="button" disabled={uploading || attempted} onClick={downloadCsvTemplate}>Download CSV Template</button><label className="button button-secondary csv-import-button">Import CSV<input ref={csvPickerRef} aria-label="Import CSV metadata" type="file" accept=".csv,text/csv" disabled={uploading || attempted} onChange={(event) => void importCsv(event.target.files)} /></label></div>{csvFeedback && <p className={csvFeedback.startsWith("Metadata applied") ? "form-success" : "form-error"} role={csvFeedback.startsWith("Metadata applied") ? "status" : "alert"}>{csvFeedback}</p>}</section>
      {csvPreview && <section className="csv-preview" aria-labelledby="csv-preview-title"><div className="section-heading"><h3 id="csv-preview-title">CSV import preview</h3><p>{csvPreview.rowsParsed} CSV row{csvPreview.rowsParsed === 1 ? "" : "s"} parsed · {csvPreview.matchedFiles} file{csvPreview.matchedFiles === 1 ? "" : "s"} matched · {csvPreview.selectedFilesWithoutRows.length} selected file{csvPreview.selectedFilesWithoutRows.length === 1 ? "" : "s"} without a CSV row.</p></div>{csvPreview.selectedFilesWithoutRows.length > 0 && <p className="notice">Files without CSV rows keep their current metadata.</p>}<section className="table-wrap batch-table-wrap" aria-label="CSV metadata preview"><table className="batch-table"><thead><tr><th>File</th><th>Field</th><th>Current value</th><th>Imported value</th><th>Result</th></tr></thead><tbody>{csvPreview.updates.flatMap((update) => update.changes.length ? update.changes.map((change) => <tr key={`${update.localId}-${change.field}`}><td>{update.relativePath}</td><td>{csvFieldLabels[change.field]}</td><td>{change.currentValue || "—"}</td><td>{change.importedValue}</td><td>Will update</td></tr>) : [<tr key={`${update.localId}-unchanged`}><td>{update.relativePath}</td><td colSpan={3}>No nonblank CSV values will change this file.</td><td>Unchanged</td></tr>])}</tbody></table></section><div className="form-actions"><button className="button button-primary" type="button" disabled={uploading || attempted || !csvPreview.updates.some((update) => update.changes.length > 0)} onClick={applyCsvMetadata}>Apply Metadata</button><button className="button button-secondary" type="button" disabled={uploading} onClick={() => { setCsvPreview(undefined); setCsvFeedback(undefined); }}>Cancel Import</button></div></section>}
      <section className="table-wrap batch-table-wrap" aria-label="Folder upload review"><table className="batch-table folder-upload-table"><thead><tr><th>File</th><th>Relative path</th><th>Metadata</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.localId}><td><strong>{item.file.name}</strong><span className="batch-file-size">{Math.ceil(item.file.size / 1024)} KiB</span></td><td>{item.sourceRelativePath}</td><td><label className="field">Number <span className="optional">Optional</span><input value={item.metadata.document_number} maxLength={150} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, document_number: event.target.value } }))} /></label><label className="field">Subject<input value={item.metadata.subject} maxLength={500} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, subject: event.target.value } }))} /></label><label className="field">Date<input type="date" value={item.metadata.document_date} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, document_date: event.target.value } }))} /></label><label className="field">Persons <span className="optional">Optional</span><input value={item.metadata.persons_involved} maxLength={500} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, persons_involved: event.target.value } }))} /></label></td><td><span className={`batch-status batch-status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>{item.error && <p className="batch-row-error" role="alert">{item.error}</p>}</td><td>{!attempted && <button className="button button-secondary table-button" type="button" disabled={uploading} onClick={() => removeItem(item.localId)}>Remove</button>}{item.status === "FAILED" && isFolderUploadRetryable(item.retryDisposition) && <button className="button button-secondary table-button" type="button" disabled={uploading} onClick={() => retryOne(item)}>Retry</button>}{item.status === "IN_PROGRESS" && <button className="button button-secondary table-button" type="button" disabled={uploading || !!(item.recheckAvailableAt && item.recheckAvailableAt > recheckClock)} onClick={() => checkAgain(item)}>Check again</button>}</td></tr>)}</tbody></table></section>
      {!canStartInitialBatch && !attempted && <p className="notice">Choose a destination and complete metadata for every included file before uploading.</p>}
      {recheckCoolingDown && <p className="notice" role="status">Wait a moment before checking unresolved uploads again.</p>}
      <div className="form-actions batch-submit-actions"><button className="button button-primary" type="button" disabled={uploading || !canStartInitialBatch} onClick={() => void startQueue(items)}>{uploading ? "Uploading folder files…" : `Upload folder files (${items.length})`}</button>{retryableFailures.length > 0 && <button className="button button-secondary" type="button" disabled={uploading} onClick={() => retryItems(retryableFailures)}>Retry failed files ({retryableFailures.length})</button>}{unresolved.length > 0 && <button className="button button-secondary" type="button" disabled={uploading || recheckCoolingDown} onClick={() => retryItems(unresolved)}>Check again ({unresolved.length})</button>}<button className="button button-secondary" type="button" disabled={uploading} onClick={requestReset}>Select another folder</button></div>
      {resetConfirmationOpen && <section className="confirmation-panel" role="dialog" aria-modal="true" aria-labelledby="discard-folder-upload-title" aria-describedby="discard-folder-upload-description" onKeyDown={(event) => { if (event.key === "Escape") setResetConfirmationOpen(false); }}><div><h2 id="discard-folder-upload-title">Discard this local batch?</h2><p id="discard-folder-upload-description">Some uploads have not been confirmed as completed. The server may still be processing them.</p><p>Discarding this local batch removes the current page&apos;s retry and reconciliation state. It does not cancel, delete, or roll back server-side uploads, and you may lose the ability to reconcile these operations from this page with their existing upload identity.</p></div><div className="confirmation-actions"><button className="button button-secondary" type="button" onClick={() => setResetConfirmationOpen(false)}>Keep current batch</button><button className="button button-danger" type="button" onClick={discardLocalBatch}>Discard local batch</button></div></section>}
    </>}
  </section>;
}
