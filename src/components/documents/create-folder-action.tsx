"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adminSubcategories, categoryUsesYear, getAdminFolderMappingKey, type AdminCategory } from "@/lib/documents/admin-categories";

export function CreateFolderAction({ categories }: { categories: readonly AdminCategory[] }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<AdminCategory>(categories[0]);
  const [year, setYear] = useState<number | null>(() => categoryUsesYear(categories[0]) ? new Date().getFullYear() : null);
  const [subcategory, setSubcategory] = useState(adminSubcategories[categories[0]]?.[0] ?? "");
  const [name, setName] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const guard = useRef(false);
  const destination = useMemo(() => getAdminFolderMappingKey(category, year ?? undefined, subcategory || undefined), [category, year, subcategory]);

  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);
  function resetAttemptIfNeeded() { if (attempted) { setKey(crypto.randomUUID()); setAttempted(false); } }
  function changeCategory(next: AdminCategory) { resetAttemptIfNeeded(); setCategory(next); setYear(categoryUsesYear(next) ? new Date().getFullYear() : null); setSubcategory(adminSubcategories[next]?.[0] ?? ""); }

  async function create() {
    if (guard.current) return;
    guard.current = true;
    setPending(true); setMessage(undefined); setAttempted(true);
    try {
      const response = await fetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_type: category, filing_year: year, filing_subcategory: subcategory, name, idempotency_key: key }) });
      const body = await response.json().catch(() => ({})) as { folder?: { name?: string; destination?: string; created?: boolean }; error?: { message?: string } };
      if (!response.ok || !body.folder) { setMessage(body.error?.message ?? "The folder could not be created. Please retry."); return; }
      setMessage(`Folder “${body.folder.name}” ${body.folder.created ? "created" : "already exists"} in ${body.folder.destination}.`);
      setName(""); setKey(crypto.randomUUID()); setAttempted(false);
    } catch { setMessage("The folder request could not be completed. Please retry."); }
    finally { setPending(false); guard.current = false; }
  }

  return <><button className="button button-secondary" type="button" onClick={() => setOpen(true)}>Create folder</button>{open && <div className="document-delete-overlay"><section className="confirmation-panel folder-dialog" role="dialog" aria-modal="true" aria-labelledby="create-folder-title" onKeyDown={(event) => { if (event.key === "Escape" && !pending) setOpen(false); }}><div className="folder-form"><h2 id="create-folder-title">Create folder</h2><label className="field">Document type<select value={category} disabled={pending} onChange={(event) => changeCategory(event.target.value as AdminCategory)}>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{categoryUsesYear(category) && <label className="field">Filing year<input type="number" min="1900" max="9999" value={year ?? ""} disabled={pending} onChange={(event) => { resetAttemptIfNeeded(); setYear(event.target.value ? Number(event.target.value) : null); }} /></label>}{(adminSubcategories[category] ?? []).length > 0 && <label className="field">Subcategory<select value={subcategory} disabled={pending} onChange={(event) => { resetAttemptIfNeeded(); setSubcategory(event.target.value); }}>{adminSubcategories[category]!.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}<label className="field">Folder name<input value={name} maxLength={100} disabled={pending} onChange={(event) => { resetAttemptIfNeeded(); setName(event.target.value); }} /></label><p className="folder-preview">Destination: <strong>{destination}{name.trim() ? ` → ${name.trim()}` : ""}</strong></p>{message && <p className={message.startsWith("Folder") ? "form-success" : "form-error"} role={message.startsWith("Folder") ? "status" : "alert"} aria-live="polite">{message}</p>}</div><div className="confirmation-actions"><button ref={cancelRef} className="button button-secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" type="button" disabled={pending || !name.trim()} onClick={() => void create()}>{pending ? "Creating…" : "Create Folder"}</button></div></section></div>}</>;
}
