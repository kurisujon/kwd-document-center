import Link from "next/link";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { getDocumentById } from "@/lib/documents/repository";
import { isDocumentId } from "@/lib/documents/query";
import { createClient } from "@/lib/supabase/server";

function Metadata({ label, value }: { label: string; value: string | null }) { return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>; }

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
  return <><header className="page-heading"><div><h1>Document detail</h1><p>Registry metadata for this document.</p></div></header><section className="document-detail"><dl><Metadata label="Document type" value={document.document_type} /><Metadata label="Document number" value={document.document_number} /><Metadata label="Document date" value={document.document_date} /><Metadata label="Subject" value={document.subject} /><Metadata label="Persons involved" value={document.persons_involved} /><Metadata label="Upload date" value={document.created_at} /><Metadata label="Uploaded by" value={document.created_by} /></dl><Link className="button button-secondary" href="/documents">Back to documents</Link></section></>;
}
