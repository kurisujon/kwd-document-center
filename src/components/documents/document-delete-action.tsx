"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function DocumentDeleteAction({ id, number, subject }: { id: string; number: string | null; subject: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) { setError(body.error?.message ?? "The document could not be deleted. Please retry."); return; }
      setOpen(false);
      router.refresh();
    } catch {
      setError("The deletion request could not be completed. Please retry.");
    } finally {
      setPending(false);
    }
  }

  return <><button className="table-action table-action-danger" type="button" onClick={() => setOpen(true)}>Delete<span className="sr-only"> {subject}</span></button>{open && <section className="confirmation-panel" role="dialog" aria-modal="true" aria-labelledby={`delete-title-${id}`} onKeyDown={(event) => { if (event.key === "Escape" && !pending) setOpen(false); }}><div><h2 id={`delete-title-${id}`}>Delete document?</h2><p>Document number: <strong>{number ?? "—"}</strong></p><p>Subject: <strong>{subject}</strong></p><p>The file will be moved to Google Drive Trash and removed from the normal Document Center list.</p>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="confirmation-actions"><button ref={cancelRef} className="button button-secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button className="button button-danger" type="button" disabled={pending} onClick={() => void confirm()}>{pending ? "Deleting…" : "Delete document"}</button></div></section>}</>;
}
