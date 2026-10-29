import Link from "next/link";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AuditQueryValidationError,
  createAuditRepository,
  validateAuditLogQuery,
  type AuditLogListQuery,
  type AuditLogListResult,
} from "@/lib/audit/audit-log";
import { requireRole } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

function auditQueryHref(
  query: AuditLogListQuery,
  updates: Partial<Record<keyof AuditLogListQuery, string | number | undefined>>,
) {
  const params = new URLSearchParams();
  const values = { ...query, ...updates };
  if (values.actor) params.set("actor", String(values.actor));
  if (values.action) params.set("action", String(values.action));
  if (values.entityType) params.set("entityType", String(values.entityType));
  if (values.entityId) params.set("entityId", String(values.entityId));
  if (values.dateFrom) params.set("dateFrom", String(values.dateFrom));
  if (values.dateTo) params.set("dateTo", String(values.dateTo));
  if (values.page !== 1) params.set("page", String(values.page));
  if (values.pageSize !== 25) params.set("pageSize", String(values.pageSize));
  const search = params.toString();
  return search ? `/admin/audit-log?${search}` : "/admin/audit-log";
}

function formatAuditMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata).filter(
    ([, val]) => val !== null && val !== undefined && val !== "",
  );
  if (entries.length === 0) return "—";
  return entries.map(([key, val]) => `${key}: ${String(val)}`).join(", ");
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("ADMIN");
  let query: AuditLogListQuery;
  try {
    query = validateAuditLogQuery(await searchParams);
  } catch (error) {
    const message =
      error instanceof AuditQueryValidationError
        ? error.message
        : "The audit log query parameters are invalid.";
    return (
      <section className="registry-error" role="alert">
        <h1>Audit log</h1>
        <p>{message}</p>
        <Link className="button button-secondary" href="/admin/audit-log">
          Clear filters
        </Link>
      </section>
    );
  }

  let result: AuditLogListResult | undefined;
  let loadFailed = false;
  try {
    const repository = createAuditRepository(createAdminClient());
    result = await repository.listAuditLogs(user.id, query);
  } catch {
    loadFailed = true;
  }

  if (loadFailed || !result) {
    return (
      <section className="registry-error" role="alert">
        <h1>Audit log unavailable</h1>
        <p>We could not load the audit log. Please try again.</p>
        <Link className="button button-secondary" href="/admin/audit-log">
          Retry
        </Link>
      </section>
    );
  }

  const activeFilterCount = [
    query.actor,
    query.action,
    query.entityType,
    query.entityId,
    query.dateFrom,
    query.dateTo,
  ].filter(Boolean).length;

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Audit log</h1>
          <p>
            Append-only activity trail for document access, uploads, confidentiality
            changes, lifecycle actions, user access, and folder operations.
          </p>
        </div>
      </header>
      <form className="search-panel" aria-label="Audit log filters">
        <div className="filter-heading">
          <div>
            <p className="eyebrow">Activity search</p>
            <h2>Filter events</h2>
          </div>
          {activeFilterCount > 0 && (
            <Link className="clear-filter" href="/admin/audit-log">
              Clear all
            </Link>
          )}
        </div>
        <label className="field">
          Actor email or ID
          <input
            name="actor"
            type="search"
            defaultValue={query.actor}
            placeholder="admin@kwd.gov.ph"
          />
        </label>
        <label className="field">
          Action
          <select name="action" defaultValue={query.action}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Entity type
          <select name="entityType" defaultValue={query.entityType}>
            <option value="">All entities</option>
            {AUDIT_ENTITY_TYPES.map((entityType) => (
              <option key={entityType} value={entityType}>
                {entityType}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Entity / Document ID
          <input
            name="entityId"
            type="search"
            defaultValue={query.entityId}
            placeholder="UUID"
          />
        </label>
        <label className="field">
          From date
          <input name="dateFrom" type="date" defaultValue={query.dateFrom} />
        </label>
        <label className="field">
          To date
          <input name="dateTo" type="date" defaultValue={query.dateTo} />
        </label>
        <button className="button button-secondary filter-submit" type="submit">
          Apply filters
        </button>
      </form>
      <section className="results-section" aria-labelledby="audit-results-title">
        <div className="results-heading">
          <div>
            <p className="eyebrow">Audit entries</p>
            <h2 id="audit-results-title">Recorded events</h2>
          </div>
          <span>{result.total.toLocaleString()} total</span>
        </div>
        <div className="table-wrap" aria-label="Audit log entries">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    <strong>No audit entries found.</strong>
                    <span>Try adjusting your filters.</span>
                  </td>
                </tr>
              ) : (
                result.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.created_at}</td>
                    <td>
                      <strong>{entry.actor_email}</strong>
                    </td>
                    <td>
                      <span className="type-label">{entry.action}</span>
                    </td>
                    <td>
                      {entry.entity_type === "DOCUMENT" ? (
                        <Link className="table-action" href={`/documents/${entry.entity_id}`}>
                          {entry.entity_type}: {entry.entity_id.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span>
                          {entry.entity_type}: {entry.entity_id.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td>{formatAuditMetadata(entry.metadata)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <nav className="pagination" aria-label="Audit log pages">
        <span>
          Showing{" "}
          {result.entries.length === 0 ? 0 : (result.page - 1) * result.pageSize + 1}–
          {Math.min(result.page * result.pageSize, result.total)} of {result.total}
        </span>
        <div>
          {result.page > 1 && (
            <Link
              className="button button-secondary"
              href={auditQueryHref(query, { page: result.page - 1 })}
            >
              Previous
            </Link>
          )}
          {result.page < result.totalPages && (
            <Link
              className="button button-secondary"
              href={auditQueryHref(query, { page: result.page + 1 })}
            >
              Next
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}
