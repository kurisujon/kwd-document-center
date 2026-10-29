import { TrashDocumentActions } from "@/components/documents/trash-document-actions";
import { requireRole } from "@/lib/auth/server";
import { listTrashedDocuments } from "@/lib/documents/delete-service";
import {
  createDeletionRepository,
  type TrashedDocumentRecord,
} from "@/lib/documents/deletion-repository";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminTrashPage() {
  const user = await requireRole("ADMIN");

  let documents: TrashedDocumentRecord[] | undefined;
  let loadFailed = false;
  try {
    documents = await listTrashedDocuments({
      actor: user,
      repository: createDeletionRepository(createAdminClient()),
    });
  } catch (err) {
    console.error("Trash load error:", err);
    loadFailed = true;
  }

  const safeDocuments = documents ?? [];

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Trash</h1>
          <p>
            Soft-deleted records remain untouched in Google Drive until an administrator
            purges them with a recorded reason, or restores them to the active registry.
          </p>
        </div>
      </header>

      {loadFailed && (
        <div className="notice" role="alert" style={{ marginBlock: "1rem", backgroundColor: "#fffbeb", borderColor: "#fde68a", color: "#92400e", padding: "0.75rem 1rem", borderRadius: "6px" }}>
          <strong>Notice:</strong> Unable to load trashed records. Please verify database migrations if trash features were recently enabled.
        </div>
      )}

      <section className="results-section" aria-labelledby="trash-results-title">
        <div className="results-heading">
          <div>
            <p className="eyebrow">Soft-deleted documents</p>
            <h2 id="trash-results-title">Trash queue</h2>
          </div>
          <span>{safeDocuments.length.toLocaleString()} total</span>
        </div>
        <div className="table-wrap" aria-label="Trashed documents">
          <table>
            <thead>
              <tr>
                <th>Document number</th>
                <th>Type</th>
                <th>Date</th>
                <th>Subject</th>
                <th>Deleted by</th>
                <th>Deleted at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {safeDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    <strong>Trash is empty.</strong>
                    <span>No soft-deleted documents are awaiting review.</span>
                  </td>
                </tr>
              ) : (
                safeDocuments.map((doc) => (
                  <tr key={doc.document_id}>
                    <td>
                      <strong>{doc.document_number ?? "—"}</strong>
                    </td>
                    <td>
                      <span className="type-label">{doc.document_type}</span>
                      {doc.confidential && (
                        <>
                          {" "}
                          <span className="type-label">Confidential</span>
                        </>
                      )}
                      {doc.deletion_state === "DELETE_FAILED" && (
                        <>
                          {" "}
                          <span className="type-label">Purge retry needed</span>
                        </>
                      )}
                    </td>
                    <td>{doc.document_date}</td>
                    <td className="subject-cell">{doc.subject}</td>
                    <td>{doc.deleted_by_email ?? "—"}</td>
                    <td>{doc.deleted_at ?? "—"}</td>
                    <td>
                      <TrashDocumentActions
                        id={doc.document_id}
                        number={doc.document_number}
                        subject={doc.subject}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
