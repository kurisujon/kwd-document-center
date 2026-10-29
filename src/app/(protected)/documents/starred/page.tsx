import Link from "next/link";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { listStarredDocuments } from "@/lib/stars/star-service";
import { createClient } from "@/lib/supabase/server";
import { DocumentStarButton } from "@/components/documents/document-star-button";

export default async function StarredDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireAuthorizedUser();
  const supabase = await createClient();
  const sp = await searchParams;

  const page = typeof sp.page === "string" ? parseInt(sp.page, 10) || 1 : 1;
  const result = await listStarredDocuments(supabase, user, { page, pageSize: 25 });

  return (
    <section className="starred-container" aria-label="Starred documents">
      <Link className="back-link" href="/documents">
        ← Back to all documents
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Personal bookmarks</p>
          <h1>Starred Documents</h1>
          <p>Quick access to documents you have bookmarked for ongoing reference.</p>
        </div>
      </header>

      <section className="results-section" aria-labelledby="starred-title">
        <div className="results-heading">
          <div>
            <p className="eyebrow">Your collection</p>
            <h2 id="starred-title">Saved items ({result.total})</h2>
          </div>
        </div>

        {result.documents.length === 0 ? (
          <p className="file-unavailable">
            You haven&apos;t starred any documents yet. Click the &ldquo;Star&rdquo; button on any document record to save it here.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Subject</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.documents.map((doc) => (
                  <tr key={doc.document_id}>
                    <td>
                      <strong>{doc.document_number || "—"}</strong>
                    </td>
                    <td>
                      <span className="type-label">{doc.document_type}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{doc.document_date}</td>
                    <td>
                      <Link className="table-action" href={`/documents/${doc.document_id}`}>
                        {doc.subject}
                      </Link>
                    </td>
                    <td>
                      <div className="row-actions">
                        <DocumentStarButton documentId={doc.document_id} initialStarred={true} />
                        <Link className="table-action" href={`/documents/${doc.document_id}`}>
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
