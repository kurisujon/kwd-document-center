"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBatchUploadItem, deriveBatchItemStatus, batchUploadConcurrency, type BatchUploadItem, type BatchUploadStatus } from "@/lib/documents/batch-upload-types";
import { createBatchUploadRunGuard, runBatchUploadQueue } from "@/lib/documents/batch-upload-queue";
import { parseFolderSelection, type FolderSelectionIssue, type FolderSelectionIssueCode } from "@/lib/documents/folder-upload-validation";
import { adminUploadAccept } from "@/lib/documents/upload-formats";

type Destination = { destinationId: string; kind: "CATEGORY" | "SUBCATEGORY" | "WORKING_FOLDER"; filingYear: number; category: string; subcategory: string | null; label: string };
type FolderItem = BatchUploadItem & { sourceRelativePath: string; sourcePathInput: string; attempted: boolean };

export function isFolderWorkflowLocked(items: readonly Pick<FolderItem, "attempted">[]) {
  return items.some((item) => item.attempted);
}

export function areAllFolderItemsReady(items: readonly Pick<FolderItem, "status">[]) {
  return items.length > 0 && items.every((item) => item.status === "READY");
}

function statusLabel(status: BatchUploadStatus) {
  return ({ QUEUED: "Needs metadata", NEEDS_METADATA: "Needs metadata", READY: "Ready", UPLOADING: "Uploading", IN_PROGRESS: "In progress", UPLOADED: "Uploaded", FAILED: "Failed", INVALID_FILE: "Invalid file", CANCELLED: "Cancelled" })[status];
}

function issueMessage(issue: FolderSelectionIssue | undefined) {
  const messages: Partial<Record<FolderSelectionIssueCode, string>> = { UNSUPPORTED_TYPE: "Unsupported file type.", FILE_TOO_LARGE: "File exceeds 4 MiB.", DUPLICATE_PATH: "Duplicate or colliding relative path.", MIXED_ROOTS: "Select one folder at a time.", PATH_TOO_DEEP: "Path exceeds the allowed directory depth.", PATH_TOO_LONG: "Path is too long.", SEGMENT_TOO_LONG: "A path segment is too long.", PATH_TRAVERSAL: "Path traversal is not allowed.", ABSOLUTE_PATH: "Absolute paths are not allowed.", CONTROL_CHARACTER: "Path contains unsupported characters.", INVALID_PATH: "Relative path is invalid.", EMPTY_FILE: "Select a non-empty file.", INCONSISTENT_FILE_TYPE: "The file type is inconsistent.", TOO_MANY_FILES: "Select no more than 25 files.", TOTAL_SIZE_EXCEEDED: "Selected files exceed the total size limit.", TOO_MANY_DIRECTORIES: "Selected files exceed the directory limit.", NO_FILES_SELECTED: "Select one folder at a time." };
  return messages[issue?.code ?? "INVALID_PATH"] ?? "File selection is invalid.";
}

function destinationMetadata(destination: Destination) {
  return { document_type: destination.category as FolderItem["metadata"]["document_type"], filing_year: destination.filingYear, filing_subcategory: destination.subcategory ?? "", document_date: "", persons_involved: "" };
}

export function FolderUploadReview({ maxBytes, onWorkflowLockChange }: { maxBytes: number; onWorkflowLockChange?: (locked: boolean) => void }) {
  const [destinationState, setDestinationState] = useState<{ status: "LOADING" | "READY" | "ERROR"; values: Destination[] }>({ status: "LOADING", values: [] });
  const [destinationId, setDestinationId] = useState("");
  const [entries, setEntries] = useState<Array<{ file: File; path: string }>>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [manifestError, setManifestError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const guard = useRef(createBatchUploadRunGuard());
  const pickerRef = useRef<HTMLInputElement>(null);
  const destination = destinationState.values.find((value) => value.destinationId === destinationId);
  const attempted = isFolderWorkflowLocked(items);
  const counts = useMemo(() => ({ ready: items.filter((item) => item.status === "READY").length, active: items.filter((item) => item.status === "UPLOADING").length, inProgress: items.filter((item) => item.status === "IN_PROGRESS").length, uploaded: items.filter((item) => item.status === "UPLOADED").length, failed: items.filter((item) => item.status === "FAILED").length, invalid: items.filter((item) => item.status === "INVALID_FILE").length }), [items]);

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

  function rebuild(nextEntries: Array<{ file: File; path: string }>, selectedDestination = destination, preserveExisting = false) {
    const manifest = parseFolderSelection(nextEntries.map(({ file, path }) => ({ name: file.name, size: file.size, type: file.type, webkitRelativePath: path })));
    setEntries(nextEntries);
    setManifestError(manifest.issues[0] ? issueMessage(manifest.issues[0]) : undefined);
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
    setItems((current) => current.map((item) => item.localId === localId && !item.attempted ? (() => { const changed = change(item); return { ...changed, status: deriveBatchItemStatus(changed, maxBytes) }; })() : item));
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
    if (!response.ok || !body.document?.document_id) throw new Error(body.error?.message ?? "The document could not be uploaded. Please retry.");
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
          onStart: (id) => setItems((current) => current.map((item) => item.localId === id ? { ...item, attempted: true, status: "UPLOADING", error: undefined } : item)),
          onSuccess: (id, result) => setItems((current) => current.map((item) => item.localId === id ? { ...item, status: result.inProgress ? "IN_PROGRESS" : "UPLOADED", documentId: result.documentId || undefined, error: result.inProgress ? "Folder upload is still in progress. Retry later with the same file." : undefined } : item)),
          onFailure: (id, error) => setItems((current) => current.map((item) => item.localId === id ? { ...item, status: "FAILED", error } : item)),
        });
      } finally { setUploading(false); }
    });
  }

  function retryPending() {
    if (uploading) return;
    const retry = items.filter((item) => item.status === "FAILED" || item.status === "IN_PROGRESS").map((item) => ({ ...item, status: "READY" as const, error: undefined }));
    setItems((current) => current.map((item) => retry.find((candidate) => candidate.localId === item.localId) ?? item));
    void startQueue(retry, true);
  }

  function removeItem(id: string) {
    if (uploading || attempted) return;
    rebuild(entries.filter((entry, index) => items[index]?.localId !== id), destination, true);
  }

  function reset() {
    if (uploading) return;
    setEntries([]); setItems([]); setManifestError(undefined); setDestinationId("");
    if (pickerRef.current) pickerRef.current.value = "";
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
      <p className="batch-summary" role="status" aria-live="polite">Folder: {rootName} · Files: {items.length} · Total: {Math.ceil(entries.reduce((total, entry) => total + entry.file.size, 0) / 1024)} KiB · Directories: {directoryCount} · Ready: {counts.ready} · Uploading: {counts.active} · In progress: {counts.inProgress} · Uploaded: {counts.uploaded} · Failed: {counts.failed}</p>
      <section className="table-wrap batch-table-wrap" aria-label="Folder upload review"><table className="batch-table folder-upload-table"><thead><tr><th>File</th><th>Relative path</th><th>Metadata</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.localId}><td><strong>{item.file.name}</strong><span className="batch-file-size">{Math.ceil(item.file.size / 1024)} KiB</span></td><td>{item.sourceRelativePath}</td><td><label className="field">Number <span className="optional">Optional</span><input value={item.metadata.document_number} maxLength={150} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, document_number: event.target.value } }))} /></label><label className="field">Subject<input value={item.metadata.subject} maxLength={500} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, subject: event.target.value } }))} /></label><label className="field">Date<input type="date" value={item.metadata.document_date} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, document_date: event.target.value } }))} /></label><label className="field">Persons <span className="optional">Optional</span><input value={item.metadata.persons_involved} maxLength={500} disabled={item.attempted || uploading || item.status === "INVALID_FILE"} onChange={(event) => updateItem(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, persons_involved: event.target.value } }))} /></label></td><td><span className={`batch-status batch-status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>{item.error && <p className="batch-row-error" role="alert">{item.error}</p>}</td><td>{!attempted && <button className="button button-secondary table-button" type="button" disabled={uploading} onClick={() => removeItem(item.localId)}>Remove</button>}</td></tr>)}</tbody></table></section>
      {!canStartInitialBatch && !attempted && <p className="notice">Choose a destination and complete metadata for every included file before uploading.</p>}
      <div className="form-actions batch-submit-actions"><button className="button button-primary" type="button" disabled={uploading || !canStartInitialBatch} onClick={() => void startQueue(items)}>{uploading ? "Uploading folder files…" : `Upload folder files (${items.length})`}</button>{(counts.failed + counts.inProgress) > 0 && <button className="button button-secondary" type="button" disabled={uploading} onClick={retryPending}>Retry pending files ({counts.failed + counts.inProgress})</button>}<button className="button button-secondary" type="button" disabled={uploading} onClick={reset}>Select another folder</button></div>
    </>}
  </section>;
}
