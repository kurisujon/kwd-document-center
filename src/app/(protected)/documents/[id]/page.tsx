import Link from "next/link";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { getDocumentById } from "@/lib/documents/repository";
import { isDocumentId } from "@/lib/documents/query";
import { createClient } from "@/lib/supabase/server";

function Metadata({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) { return <div className={wide ? "metadata-wide" : undefined}><dt>{label}</dt><dd>{value || "—"}</dd></div>; }

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuthorizedUser();
  const { id } = await params;
  if (!isDocumentId(id)) return <section className="placeholder"><h1>Document unavailable</h1><p>The requested document could not be found.</p><Link className="button button-secondary" href="/documents">Back to documents</Link></section>;
  let document;
  let loadFailed = false;
  try {
    document = await getDocumentById(await createClient(), id);
  } catch {
    loadFailed = true;
  }
  if (loadFailed) return <section className="registry-error" role="alert"><h1>Document unavailable</h1><p>We could not load this document. Please try again.</p><Link className="button button-secondary" href="/documents">Back to documents</Link></section>;
  if (!document) return <section className="placeholder"><h1>Document unavailable</h1><p>The requested document could not be found.</p><Link className="button button-secondary" href="/documents">Back to documents</Link></section>;
  return <><Link className="back-link" href="/documents">← Back to documents</Link><header className="page-heading document-heading"><div><p className="eyebrow">Document record</p><h1>{document.subject}</h1><p>{document.document_number || document.file_name || "KWD registry document"}</p></div></header><section className="document-layout"><article className="document-detail"><div className="section-heading"><p className="eyebrow">Registry metadata</p><h2>Document information</h2></div><dl><Metadata label="Document type" value={document.document_type} /><Metadata label="Filing year" value={document.filing_year?.toString() ?? null} /><Metadata label="Subcategory" value={document.filing_subcategory} /><Metadata label="Document number" value={document.document_number} /><Metadata label="Document date" value={document.document_date} /><Metadata label="Subject" value={document.subject} wide /><Metadata label="Persons involved" value={document.persons_involved} wide /><Metadata label="File name" value={document.file_name} wide /><Metadata label="Upload date" value={document.created_at} /><Metadata label="Uploaded by" value={document.created_by} /></dl></article><aside className="file-panel"><p className="eyebrow">Source file</p><h2>Open or download</h2><p>The file remains in the approved KWD Google Drive location.</p><div className="document-actions">{document.drive_file_id ? <><a className="button button-primary" href={`/api/documents/${document.document_id}/open`} target="_blank" rel="noreferrer">Open in Drive ↗</a><a className="button button-secondary" href={`/api/documents/${document.document_id}/download`}>Download file</a></> : <p className="file-unavailable">No Google Drive file is linked to this registry record.</p>}</div></aside></section></>;
}
