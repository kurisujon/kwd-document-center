import Link from "next/link";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { ReportPrintButton } from "@/components/reports/report-print-button";
import { getAllDocumentTypes } from "@/lib/documents/document-types-config";
import { fetchReportDocuments, type ReportFilterOptions } from "@/lib/reports/report-service";
import { createClient } from "@/lib/supabase/server";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireAuthorizedUser();
  const supabase = await createClient();
  const sp = await searchParams;

  const type = typeof sp.type === "string" ? sp.type : undefined;
  const yearStr = typeof sp.year === "string" ? sp.year : undefined;
  const year = yearStr && /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : undefined;
  const dateFrom = typeof sp.dateFrom === "string" ? sp.dateFrom : undefined;
  const dateTo = typeof sp.dateTo === "string" ? sp.dateTo : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const retentionStatus = typeof sp.retentionStatus === "string" ? sp.retentionStatus : undefined;

  const filters: ReportFilterOptions = {
    type,
    year,
    dateFrom,
    dateTo,
    status,
    retentionStatus,
  };

  const allTypes = getAllDocumentTypes();
  const documents = await fetchReportDocuments(supabase, filters, user);

  // Build export query string
  const exportParams = new URLSearchParams();
  if (type) exportParams.set("type", type);
  if (year) exportParams.set("year", year.toString());
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);
  if (status) exportParams.set("status", status);
  if (retentionStatus) exportParams.set("retentionStatus", retentionStatus);
  const exportUrl = `/api/reports/export?${exportParams.toString()}`;

  return (
    <section className="reports-container" aria-label="District reports center">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Records inventories and audits</p>
          <h1>Reports & Exports</h1>
          <p>Generate filtered inventory reports, official CSV exports, and printable summaries.</p>
        </div>
      </header>

      {/* Filter Form (hidden on print) */}
      <section className="search-panel no-print" aria-label="Report filters">
        <form method="GET" action="/reports">
          <div className="filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
            <div>
              <label htmlFor="report-type" className="form-label">Document category</label>
              <select id="report-type" name="type" className="form-select" defaultValue={type ?? ""}>
                <option value="">All Categories</option>
                {allTypes.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="report-year" className="form-label">Filing year</label>
              <input
                id="report-year"
                name="year"
                type="number"
                min="1990"
                max="2100"
                placeholder="e.g. 2026"
                defaultValue={year?.toString() ?? ""}
                className="form-input"
              />
            </div>

            <div>
              <label htmlFor="report-date-from" className="form-label">Date from</label>
              <input
                id="report-date-from"
                name="dateFrom"
                type="date"
                defaultValue={dateFrom ?? ""}
                className="form-input"
              />
            </div>

            <div>
              <label htmlFor="report-date-to" className="form-label">Date to</label>
              <input
                id="report-date-to"
                name="dateTo"
                type="date"
                defaultValue={dateTo ?? ""}
                className="form-input"
              />
            </div>

            <div>
              <label htmlFor="report-retention" className="form-label">Retention status</label>
              <select id="report-retention" name="retentionStatus" className="form-select" defaultValue={retentionStatus ?? ""}>
                <option value="">All Retention</option>
                <option value="ACTIVE">Active</option>
                <option value="PENDING_REVIEW">Pending Review</option>
                <option value="ARCHIVED">Archived</option>
                <option value="DISPOSED">Disposed</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button className="button button-primary" type="submit">
              Apply filters
            </button>
            <Link className="button button-secondary" href="/reports">
              Reset filters
            </Link>
          </div>
        </form>
      </section>

      {/* Results and Export Bar */}
      <div className="results-heading" style={{ marginTop: "1.5rem" }}>
        <div>
          <p className="eyebrow">Matching inventory</p>
          <h2>{documents.length} Records Found</h2>
        </div>
        <div className="no-print" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <a
            className="button button-secondary"
            href={exportUrl}
            download
          >
            Export CSV
          </a>
          <ReportPrintButton />
        </div>
      </div>

      {documents.length === 0 ? (
        <p className="file-unavailable">No documents matched the selected report filters.</p>
      ) : (
        <div className="table-wrap report-print-table">
          <table>
            <thead>
              <tr>
                <th>Document #</th>
                <th>Type</th>
                <th>Subject</th>
                <th>Date</th>
                <th>Status</th>
                <th>Retention</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.document_id}>
                  <td>
                    <strong>{doc.document_number || "—"}</strong>
                  </td>
                  <td>
                    <span className="type-label">{doc.document_type}</span>
                  </td>
                  <td>{doc.subject}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{doc.document_date}</td>
                  <td>
                    <span className="type-label">{doc.status}</span>
                  </td>
                  <td>
                    <span className="type-label">{doc.retention_status ?? "ACTIVE"}</span>
                  </td>
                  <td className="no-print">
                    <Link className="table-action" href={`/documents/${doc.document_id}`}>
                      View record
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
