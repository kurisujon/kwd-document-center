import Link from "next/link";
import { createAuditRepository, type AuditLogEntry } from "@/lib/audit/audit-log";
import { canReadDocument } from "@/lib/auth/permissions";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { getDocumentTypeConfig } from "@/lib/documents/document-types-config";
import { isInlinePreviewableMimeType } from "@/lib/documents/file-api";
import {
  listDocumentLinks,
  listDocumentTags,
  listDocumentVersions,
} from "@/lib/documents/lifecycle-repository";
import { getDocumentById } from "@/lib/documents/repository";
import { isDocumentId } from "@/lib/documents/query";
import type { DocumentLinkRecord, DocumentVersionRecord, TagRecord } from "@/lib/documents/types";
import { getDocumentText, type DocumentTextRecord } from "@/lib/ocr/ocr-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DocumentConfidentialityAction } from "@/components/documents/document-confidentiality-action";
import { DocumentCommentsPanel } from "@/components/documents/document-comments-panel";
import { DocumentRetentionAction } from "@/components/documents/document-retention-action";
import { DocumentStarButton } from "@/components/documents/document-star-button";
import { DocumentQrCode } from "@/components/documents/document-qr-code";
import { isDocumentStarred } from "@/lib/stars/star-service";
import { listDocumentComments } from "@/lib/comments/comment-service";
import type { DocumentCommentRecord } from "@/lib/documents/types";

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

  const supabase = await createClient();
  let activityEntries: AuditLogEntry[] = [];
  let links: DocumentLinkRecord[] = [];
  let versions: DocumentVersionRecord[] = [];
  let tags: TagRecord[] = [];
  let docText: DocumentTextRecord | null = null;
  let comments: DocumentCommentRecord[] = [];
  let isStarred = false;

  try {
    const [linksRes, versionsRes, tagsRes, docTextRes, commentsRes, starredRes] = await Promise.all([
      listDocumentLinks(supabase, document.document_id, user),
      listDocumentVersions(supabase, document.document_id, user),
      listDocumentTags(supabase, document.document_id, user),
      getDocumentText(supabase, document.document_id, user),
      listDocumentComments(supabase, user, document.document_id),
      isDocumentStarred(supabase, user.id, document.document_id),
    ]);
    links = linksRes;
    versions = versionsRes;
    tags = tagsRes;
    docText = docTextRes;
    comments = commentsRes;
    isStarred = starredRes;
  } catch {
    // Non-fatal if extended properties fail to load
  }

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
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <DocumentStarButton
            documentId={document.document_id}
            initialStarred={isStarred}
          />
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
            <Metadata label="Status" value={document.status} />
            <Metadata label="Retention status" value={document.retention_status ?? "ACTIVE"} />
            {document.expires_at && (
              <Metadata label="Expiration date" value={new Date(document.expires_at).toLocaleDateString()} />
            )}
            {document.due_at && (
              <Metadata label="Action due date" value={new Date(document.due_at).toLocaleDateString()} />
            )}
            <Metadata label="Version" value={`v${document.version_count || 1}`} />
            <Metadata label="OCR status" value={docText?.ocr_status ?? "PENDING"} />
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

          {docText?.extracted_text && (
            <section className="document-extracted-text-section" aria-label="Extracted text" style={{ marginTop: "1.5rem" }}>
              <div className="section-heading">
                <p className="eyebrow">Searchable content</p>
                <h2>Extracted text</h2>
              </div>
              <details style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "4px", padding: "0.75rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>View extracted full-text</summary>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.75rem", fontSize: "0.85rem", maxHeight: "300px", overflowY: "auto" }}>
                  {docText.extracted_text}
                </pre>
              </details>
            </section>
          )}

          {tags.length > 0 && (
            <div className="metadata-tags" style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="type-label"
                  style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.85rem" }}
                >
                  #{tag.name}
                </span>
              ))}
            </div>
          )}

          <section className="document-relationships-section" aria-label="Document relationships" style={{ marginTop: "2rem" }}>
            <div className="section-heading">
              <p className="eyebrow">Lineage & connections</p>
              <h2>Related documents</h2>
            </div>
            {links.length === 0 ? (
              <p className="file-unavailable">No relationships linked to this document.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Relationship</th>
                      <th>Document</th>
                      <th>Type</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.id}>
                        <td>
                          <span className="type-label">{link.relation}</span>
                        </td>
                        <td>
                          {link.target_document ? (
                            <>
                              <strong>{link.target_document.document_number || "Document"}</strong>: {link.target_document.subject}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{link.target_document?.document_type || "—"}</td>
                        <td>
                          {link.target_document && (
                            <Link className="table-action" href={`/documents/${link.target_document.document_id}`}>
                              View document
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="document-versions-section" aria-label="Version history" style={{ marginTop: "2rem" }}>
            <div className="section-heading">
              <p className="eyebrow">Provenance</p>
              <h2>Version history</h2>
            </div>
            {versions.length === 0 ? (
              <p className="file-unavailable">Current version (v1) is active.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>File name</th>
                      <th>Summary</th>
                      <th>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <span className="type-label">v{v.version_number}</span>
                        </td>
                        <td>{v.file_name}</td>
                        <td>{v.change_summary || "Initial version"}</td>
                        <td>{v.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <DocumentCommentsPanel
            documentId={document.document_id}
            initialComments={comments}
            canComment={user.role === "ADMIN" || user.role === "STAFF"}
          />

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
          <DocumentRetentionAction
            documentId={document.document_id}
            initialStatus={document.retention_status ?? "ACTIVE"}
            retentionPeriodMonths={document.retention_period_months ?? null}
            isAdmin={user.role === "ADMIN"}
          />
          <DocumentQrCode
            documentId={document.document_id}
            documentNumber={document.document_number}
            subject={document.subject}
          />
        </aside>
      </section>
    </>
  );
}
