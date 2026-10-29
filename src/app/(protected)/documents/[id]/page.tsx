import Link from "next/link";
import { createAuditRepository, type AuditLogEntry } from "@/lib/audit/audit-log";
import { canReadDocument } from "@/lib/auth/permissions";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { getDocumentTypeConfig } from "@/lib/documents/document-types-config";
import { isInlinePreviewableMimeType } from "@/lib/documents/file-api";
import { getDocumentById } from "@/lib/documents/repository";
import { isDocumentId } from "@/lib/documents/query";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DocumentConfidentialityAction } from "@/components/documents/document-confidentiality-action";

function Metadata({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuthorizedUser();
  const { id } = await params;
  if (!isDocumentId(id)) {
    return (
      <section className="placeholder">
        <h1>Document unavailable</h1>
        <p>The requested document could not be found.</p>
        <Link className="button button-secondary" href="/documents">
          Back to documents
        </Link>
      </section>
    );
  }

  let document;
  let loadFailed = false;
  try {
    document = await getDocumentById(await createClient(), id, user);
  } catch {
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <section className="registry-error" role="alert">
        <h1>Document unavailable</h1>
        <p>We could not load this document. Please try again.</p>
        <Link className="button button-secondary" href="/documents">
          Back to documents
        </Link>
      </section>
    );
  }

  if (!document || !canReadDocument(user, document)) {
    return (
      <section className="placeholder">
        <h1>Document unavailable</h1>
        <p>The requested document could not be found.</p>
        <Link className="button button-secondary" href="/documents">
          Back to documents
        </Link>
      </section>
    );
  }

  let activityEntries: AuditLogEntry[] = [];
  if (user.role === "ADMIN") {
    try {
      const auditResult = await createAuditRepository(createAdminClient()).listAuditLogs(
        user.id,
        {
          actor: "",
          action: "",
          entityType: "DOCUMENT",
          entityId: document.document_id,
          dateFrom: "",
          dateTo: "",
          page: 1,
          pageSize: 10,
        },
      );
      activityEntries = auditResult.entries;
    } catch {
      activityEntries = [];
    }
  }

  const normalizedMime = document.file_type?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const canInlinePreview =
    Boolean(document.drive_file_id) && isInlinePreviewableMimeType(normalizedMime);
  const inlinePreviewUrl = `/api/documents/${document.document_id}/download?inline=1`;

  return (
    <>
      <Link className="back-link" href="/documents">
        ← Back to documents
      </Link>
      <header className="page-heading document-heading">
        <div>
          <p className="eyebrow">Document record</p>
          <h1>{document.subject}</h1>
          <p>{document.document_number || document.file_name || "KWD registry document"}</p>
        </div>
      </header>
      <section className="document-layout">
        <article className="document-detail">
          <div className="section-heading">
            <p className="eyebrow">Registry metadata</p>
            <h2>Document information</h2>
          </div>
          <dl>
            <Metadata label="Document type" value={document.document_type} />
            <Metadata label="Filing year" value={document.filing_year?.toString() ?? null} />
            <Metadata label="Subcategory" value={document.filing_subcategory} />
            <Metadata label="Document number" value={document.document_number} />
            <Metadata label="Document date" value={document.document_date} />
            <Metadata label="Subject" value={document.subject} />
            <Metadata label="Persons involved" value={document.persons_involved} />
            <Metadata
              label="Access level"
              value={document.confidential ? "Confidential (Admin only)" : "Standard"}
            />
            <Metadata label="File name" value={document.file_name} />
            <Metadata label="Upload date" value={document.created_at} />
            <Metadata label="Uploaded by" value={document.created_by} />
            {(() => {
              const typeConfig = getDocumentTypeConfig(document.document_type);
              const customMeta = (document.custom_metadata ?? {}) as Record<string, unknown>;
              return typeConfig?.fields.map((field) => {
                const rawVal = customMeta[field.key];
                if (rawVal === undefined || rawVal === null || rawVal === "") return null;
                let displayVal = String(rawVal);
                if (field.type === "select" && field.options) {
                  const opt = field.options.find((o) => o.value === rawVal);
                  if (opt) displayVal = opt.label;
                }
                return <Metadata key={field.key} label={field.label} value={displayVal} />;
              });
            })()}
          </dl>

          {document.drive_file_id && (
            <section className="document-preview-section" aria-label="Document preview">
              <div className="section-heading">
                <p className="eyebrow">Inline preview</p>
                <h2>Document preview</h2>
              </div>
              {canInlinePreview ? (
                normalizedMime === "application/pdf" ? (
                  <iframe
                    className="document-preview-frame"
                    src={inlinePreviewUrl}
                    title={`Preview of ${document.subject}`}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="document-preview-image"
                    src={inlinePreviewUrl}
                    alt={document.subject}
                  />
                )
              ) : (
                <p className="file-unavailable">
                  Inline preview is available for PDF and image files. Use Open in Drive or
                  Download file to view this document.
                </p>
              )}
            </section>
          )}

          {user.role === "ADMIN" && (
            <section className="document-activity-section" aria-label="Document activity">
              <div className="results-heading">
                <div>
                  <p className="eyebrow">Audit history</p>
                  <h2>Activity</h2>
                </div>
                <Link
                  className="table-action"
                  href={`/admin/audit-log?entityType=DOCUMENT&entityId=${document.document_id}`}
                >
                  Full audit log
                </Link>
              </div>
              {activityEntries.length === 0 ? (
                <p className="file-unavailable">
                  No audit activity recorded for this document yet.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Actor</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.created_at}</td>
                          <td>{entry.actor_email}</td>
                          <td>
                            <span className="type-label">{entry.action}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </article>
        <aside className="file-panel">
          <p className="eyebrow">Source file</p>
          <h2>Open or download</h2>
          <p>The file remains in the approved KWD Google Drive location.</p>
          <div className="document-actions">
            {document.drive_file_id ? (
              <>
                <a
                  className="button button-primary"
                  href={`/api/documents/${document.document_id}/open`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Drive ↗
                </a>
                <a
                  className="button button-secondary"
                  href={`/api/documents/${document.document_id}/download`}
                >
                  Download file
                </a>
              </>
            ) : (
              <p className="file-unavailable">
                No Google Drive file is linked to this registry record.
              </p>
            )}
          </div>
          {user.role === "ADMIN" && (
            <DocumentConfidentialityAction
              id={document.document_id}
              confidential={Boolean(document.confidential)}
            />
          )}
        </aside>
      </section>
    </>
  );
}
