"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adminSubcategories, categoryUsesYear, type AdminCategory } from "@/lib/documents/admin-categories";
import { appendBatchFiles, applyToSelectedBatchItems, batchUploadConcurrency, isBatchItemEditable, maximumBatchUploadFiles, prepareFailedBatchRetry, removeEditableBatchItem, selectAllEditableBatchItems, updateBatchItem, type BatchUploadDefaults, type BatchUploadItem } from "@/lib/documents/batch-upload-types";
import { createBatchUploadRunGuard, runBatchUploadQueue } from "@/lib/documents/batch-upload-queue";
import { adminUploadAccept } from "@/lib/documents/upload-formats";

type Props = { categories: readonly AdminCategory[]; maxBytes: number };

function defaultValues(category: AdminCategory): BatchUploadDefaults {
  return { document_type: category, filing_year: categoryUsesYear(category) ? new Date().getFullYear() : null, filing_subcategory: adminSubcategories[category]?.[0] ?? "", document_date: "", persons_involved: "" };
}

function statusLabel(status: BatchUploadItem["status"]) {
  return ({ QUEUED: "Needs metadata", NEEDS_METADATA: "Needs metadata", READY: "Ready", UPLOADING: "Uploading", IN_PROGRESS: "In progress", UPLOADED: "Uploaded", FAILED: "Failed", INVALID_FILE: "Invalid file", CANCELLED: "Cancelled" })[status];
}

export function BatchUploadReview({ categories, maxBytes }: Props) {
  const [defaults, setDefaults] = useState<BatchUploadDefaults>(() => defaultValues(categories[0]));
  const [items, setItems] = useState<BatchUploadItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [bulkPersons, setBulkPersons] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const queueGuard = useRef(createBatchUploadRunGuard());

  const counts = useMemo(() => ({
    ready: items.filter((item) => item.status === "READY").length,
    active: items.filter((item) => item.status === "UPLOADING").length,
    uploaded: items.filter((item) => item.status === "UPLOADED").length,
    failed: items.filter((item) => item.status === "FAILED").length,
  }), [items]);

  useEffect(() => {
    if (!counts.active) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [counts.active]);

  function replaceItem(localId: string, change: (item: BatchUploadItem) => BatchUploadItem) {
    setItems((current) => updateBatchItem(current, localId, change, maxBytes));
  }

  function updateDefaults(change: Partial<BatchUploadDefaults>) {
    setDefaults((current) => ({ ...current, ...change }));
  }

  function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const next = appendBatchFiles(items, selectedFiles, defaults, maxBytes);
    setSelectionError(next.error);
    if (!next.error) setItems(next.items);
  }

  function toggleRow(localId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(localId); else next.delete(localId);
      return next;
    });
  }

  function applyToSelected(change: (item: BatchUploadItem) => BatchUploadItem) {
    if (!selected.size) return;
    setItems((current) => applyToSelectedBatchItems(current, selected, change, maxBytes));
  }

  function applyDefaults() {
    applyToSelected((item) => ({ ...item, metadata: { ...item.metadata, ...defaults } }));
  }

  async function submitOne(item: BatchUploadItem) {
    const formData = new FormData();
    formData.set("document_type", item.metadata.document_type);
    formData.set("filing_year", item.metadata.filing_year === null ? "" : String(item.metadata.filing_year));
    formData.set("filing_subcategory", item.metadata.filing_subcategory);
    formData.set("document_number", item.metadata.document_number);
    formData.set("document_date", item.metadata.document_date);
    formData.set("subject", item.metadata.subject);
    formData.set("persons_involved", item.metadata.persons_involved);
    formData.set("idempotency_key", item.idempotencyKey);
    formData.set("file", item.file, item.file.name);
    const response = await fetch("/api/documents", { method: "POST", body: formData });
    const body = await response.json().catch(() => ({})) as { document?: { document_id?: string }; error?: { message?: string } };
    if (!response.ok || !body.document?.document_id) throw new Error(body.error?.message ?? "The document could not be uploaded. Please retry.");
    return { documentId: body.document.document_id };
  }

  async function startQueue(source = items) {
    if (uploading || !source.some((item) => item.status === "READY")) return;
    await queueGuard.current.run(async () => {
      setUploading(true);
      try {
        await runBatchUploadQueue({
          items: source,
          concurrency: batchUploadConcurrency,
          upload: submitOne,
          onStart: (localId) => setItems((current) => current.map((item) => item.localId === localId ? { ...item, status: "UPLOADING", error: undefined } : item)),
          onSuccess: (localId, result) => setItems((current) => current.map((item) => item.localId === localId ? { ...item, status: "UPLOADED", documentId: result.documentId, error: undefined } : item)),
          onFailure: (localId, error) => setItems((current) => current.map((item) => item.localId === localId ? { ...item, status: "FAILED", error } : item)),
        });
      } finally {
        setUploading(false);
      }
    });
  }

  function retryFailed() {
    if (uploading) return;
    const retry = prepareFailedBatchRetry(items, maxBytes);
    setItems(retry.items);
    void startQueue(retry.candidates);
  }

  const allSelectable = items.filter(isBatchItemEditable);
  const allSelected = allSelectable.length > 0 && allSelectable.every((item) => selected.has(item.localId));

  return <section className="batch-upload" aria-labelledby="batch-upload-title">
    <div className="section-heading"><h2 id="batch-upload-title">Select documents</h2><p>Select up to {maximumBatchUploadFiles} approved files. Every file remains an independent upload.</p></div>
    <div className="upload-config-grid">
      <label className="field file-field upload-dropzone">
        <span className="upload-dropzone-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
        </span>
        <span className="upload-dropzone-title">Document files</span>
        <input aria-label="Select document files" type="file" multiple accept={adminUploadAccept} disabled={uploading} onChange={(event) => { selectFiles(event.target.files); event.currentTarget.value = ""; }} />
        <span>Accepted files: PDF, Word, Excel, CSV, PowerPoint, JPG, PNG, and TXT. Maximum {Math.floor(maxBytes / 1024 / 1024)} MiB each.</span>
      </label>
      <fieldset className="batch-defaults" disabled={uploading}><legend>Common defaults</legend>
        <label className="field">Admin category<select value={defaults.document_type} onChange={(event) => { const category = event.target.value as AdminCategory; updateDefaults(defaultValues(category)); }}><>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</></select></label>
        {categoryUsesYear(defaults.document_type) && <label className="field">Filing year<input type="number" min="1900" max="9999" value={defaults.filing_year ?? ""} onChange={(event) => updateDefaults({ filing_year: event.target.value ? Number(event.target.value) : null })} /></label>}
        {(adminSubcategories[defaults.document_type] ?? []).length > 0 && <label className="field">Subcategory<select value={defaults.filing_subcategory} onChange={(event) => updateDefaults({ filing_subcategory: event.target.value })}>{adminSubcategories[defaults.document_type]!.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
        <label className="field">Default date <span className="optional">Optional</span><input type="date" value={defaults.document_date} onChange={(event) => updateDefaults({ document_date: event.target.value })} /></label>
        <label className="field">Default persons involved <span className="optional">Optional</span><input value={defaults.persons_involved} maxLength={500} onChange={(event) => updateDefaults({ persons_involved: event.target.value })} /></label>
      </fieldset>
    </div>
    {selectionError && <p className="form-error" role="alert">{selectionError}</p>}
    {items.length > 0 && <>
      <section className="batch-actions" aria-label="Bulk metadata actions">
        <label><input type="checkbox" checked={allSelected} disabled={uploading || !allSelectable.length} onChange={(event) => setSelected(event.target.checked ? selectAllEditableBatchItems(items) : new Set())} /> Select all editable rows</label>
        <label>Set date<input type="date" value={bulkDate} disabled={uploading} onChange={(event) => setBulkDate(event.target.value)} /></label><button className="button button-secondary" type="button" disabled={uploading || !selected.size || !bulkDate} onClick={() => applyToSelected((item) => ({ ...item, metadata: { ...item.metadata, document_date: bulkDate } }))}>Apply date</button>
        <label>Set persons<input value={bulkPersons} maxLength={500} disabled={uploading} onChange={(event) => setBulkPersons(event.target.value)} /></label><button className="button button-secondary" type="button" disabled={uploading || !selected.size} onClick={() => applyToSelected((item) => ({ ...item, metadata: { ...item.metadata, persons_involved: bulkPersons } }))}>Apply persons</button>
        <button className="button button-secondary" type="button" disabled={uploading || !selected.size} onClick={applyDefaults}>Apply common defaults</button><button className="button button-secondary" type="button" disabled={uploading || !selected.size} onClick={() => applyToSelected((item) => ({ ...item, metadata: { ...item.metadata, persons_involved: "" } }))}>Clear persons</button>
      </section>
      <p className="batch-summary" role="status" aria-live="polite">Ready: {counts.ready} · Uploading: {counts.active} · Uploaded: {counts.uploaded} · Failed: {counts.failed}</p>
      <section className="table-wrap batch-table-wrap" aria-label="Bulk metadata review"><table className="batch-table"><thead><tr><th scope="col"><span className="sr-only">Select</span></th><th scope="col">File</th><th scope="col">Document metadata</th><th scope="col">Destination</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{items.map((item) => <BatchUploadRow key={item.localId} item={item} categories={categories} checked={selected.has(item.localId)} disabled={uploading} onSelect={toggleRow} onChange={replaceItem} onRemove={() => { const next = removeEditableBatchItem(items, selected, item.localId); setItems(next.items); setSelected(next.selected); }} />)}</tbody></table></section>
      <div className="form-actions batch-submit-actions"><button className="button button-primary" type="button" disabled={uploading || !counts.ready} onClick={() => void startQueue()}>{uploading ? "Uploading ready files…" : `Upload ready files (${counts.ready})`}</button>{counts.failed > 0 && <button className="button button-secondary" type="button" disabled={uploading} onClick={retryFailed}>Retry failed ({counts.failed})</button>}</div>
    </>}
  </section>;
}

export function BatchUploadRow({ item, categories, checked, disabled, onSelect, onChange, onRemove }: { item: BatchUploadItem; categories: readonly AdminCategory[]; checked: boolean; disabled: boolean; onSelect: (id: string, checked: boolean) => void; onChange: (id: string, change: (item: BatchUploadItem) => BatchUploadItem) => void; onRemove: () => void }) {
  const editable = isBatchItemEditable(item) && !disabled;
  const setMetadata = (change: Partial<BatchUploadItem["metadata"]>) => onChange(item.localId, (current) => ({ ...current, metadata: { ...current.metadata, ...change } }));
  const subcategories = adminSubcategories[item.metadata.document_type] ?? [];
  return <tr><td><input aria-label={`Select ${item.file.name}`} type="checkbox" checked={checked} disabled={!editable} onChange={(event) => onSelect(item.localId, event.target.checked)} /></td><td><strong>{item.file.name}</strong><span className="batch-file-size">{Math.ceil(item.file.size / 1024)} KiB</span></td><td><label className="field">Number <span className="optional">Optional</span><input aria-label={`Document number for ${item.file.name}`} value={item.metadata.document_number} maxLength={150} disabled={!editable} onChange={(event) => setMetadata({ document_number: event.target.value })} /></label><label className="field">Subject<input aria-label={`Subject for ${item.file.name}`} value={item.metadata.subject} maxLength={500} disabled={!editable} onChange={(event) => setMetadata({ subject: event.target.value })} /></label>{!item.metadata.subject && item.suggestedSubject && <button className="table-action" type="button" disabled={!editable} onClick={() => setMetadata({ subject: item.suggestedSubject })}>Use filename suggestion</button>}<label className="field">Persons <span className="optional">Optional</span><input aria-label={`Persons involved for ${item.file.name}`} value={item.metadata.persons_involved} maxLength={500} disabled={!editable} onChange={(event) => setMetadata({ persons_involved: event.target.value })} /></label><label className="field">Date<input aria-label={`Document date for ${item.file.name}`} type="date" value={item.metadata.document_date} disabled={!editable} onChange={(event) => setMetadata({ document_date: event.target.value })} /></label></td><td><label className="field">Type<select aria-label={`Document type for ${item.file.name}`} value={item.metadata.document_type} disabled={!editable} onChange={(event) => { const category = event.target.value as AdminCategory; setMetadata({ document_type: category, filing_year: categoryUsesYear(category) ? (item.metadata.filing_year ?? new Date().getFullYear()) : null, filing_subcategory: adminSubcategories[category]?.[0] ?? "" }); }}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>{categoryUsesYear(item.metadata.document_type) && <label className="field">Year<input aria-label={`Filing year for ${item.file.name}`} type="number" min="1900" max="9999" value={item.metadata.filing_year ?? ""} disabled={!editable} onChange={(event) => setMetadata({ filing_year: event.target.value ? Number(event.target.value) : null })} /></label>}{subcategories.length > 0 && <label className="field">Subcategory<select aria-label={`Subcategory for ${item.file.name}`} value={item.metadata.filing_subcategory} disabled={!editable} onChange={(event) => setMetadata({ filing_subcategory: event.target.value })}>{subcategories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}</td><td><span className={`batch-status batch-status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>{item.error && <p className="batch-row-error" role="alert">{item.error}</p>}{item.documentId && <p className="batch-row-success">Registered</p>}</td><td>{isBatchItemEditable(item) && <button className="button button-secondary table-button" type="button" disabled={disabled} onClick={onRemove}>Remove</button>}</td></tr>;
}
