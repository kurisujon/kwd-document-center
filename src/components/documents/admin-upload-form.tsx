"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { adminSubcategories, categoryUsesYear, type AdminCategory } from "@/lib/documents/admin-categories";
import { adminUploadAccept } from "@/lib/documents/upload-formats";

type UploadResponse = {
  document?: { document_id: string; subject: string };
  error?: { code: string; message: string; field?: string };
};

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function AdminUploadForm({ categories }: { categories: readonly AdminCategory[] }) {
  const [category, setCategory] = useState<AdminCategory>(categories[0]);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [documentId, setDocumentId] = useState<string>();
  const subcategories = useMemo(() => adminSubcategories[category] ?? [], [category]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitting(true);
    setError(undefined);
    setDocumentId(undefined);
    const formData = new FormData(form);
    formData.set("idempotency_key", idempotencyKey);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: formData });
      const body = await response.json() as UploadResponse;
      if (!response.ok || !body.document) {
        setError(body.error?.message ?? "The document could not be uploaded. Please retry.");
        return;
      }
      setDocumentId(body.document.document_id);
      setIdempotencyKey(newIdempotencyKey());
      form.reset();
      setCategory(categories[0]);
    } catch {
      setError("The upload response was interrupted. Retry without changing the form so the existing upload can be recovered.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="upload-form" onSubmit={submit}>
      <label className="field">Admin category
        <select name="document_type" value={category} onChange={(event) => setCategory(event.target.value as AdminCategory)} required>
          {categories.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      {categoryUsesYear(category) && <label className="field">Filing year<input name="filing_year" type="number" min="1900" max="9999" defaultValue={new Date().getFullYear()} required /></label>}
      {subcategories.length > 0 && <label className="field">Subcategory<select name="filing_subcategory" required><option value="">Select a subcategory</option>{subcategories.map((value) => <option key={value}>{value}</option>)}</select></label>}
      <label className="field">Document number <span className="optional">Optional</span><input name="document_number" maxLength={150} /></label>
      <label className="field">Document date<input name="document_date" type="date" required /></label>
      <label className="field">Subject<input name="subject" maxLength={500} required /></label>
      <label className="field">Persons involved <span className="optional">Optional</span><textarea name="persons_involved" maxLength={500} rows={3} /></label>
      <label className="field file-field">Document file<input name="file" type="file" accept={adminUploadAccept} required /><span>Accepted files: PDF, Word, Excel, CSV, PowerPoint, JPG, PNG, and TXT. Maximum 4 MiB unless deployment configuration specifies otherwise.</span></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      {documentId && <div className="form-success" role="status">Upload complete. <Link href={`/documents/${documentId}`}>View the document</Link>.</div>}
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Uploading…" : "Upload document"}</button></div>
    </form>
  );
}
