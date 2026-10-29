import Link from "next/link";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { getDashboardMetrics } from "@/lib/dashboard/dashboard-service";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const user = await requireAuthorizedUser();
  const supabase = await createClient();

  const metrics = await getDashboardMetrics(supabase, user);

  return (
    <section className="dashboard-container" aria-label="Records dashboard">
      <header className="page-heading">
        <div>
          <p className="eyebrow">District records overview</p>
          <h1>Dashboard</h1>
          <p>Real-time records metrics and action deadlines across Kiblawan Water District.</p>
        </div>
      </header>

      {/* Metrics Summary Cards */}
      <div
        className="dashboard-metrics-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBlock: "1.5rem",
        }}
      >
        <div
          className="metric-card"
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.25rem",
          }}
        >
          <p className="eyebrow" style={{ margin: 0, color: "#6b7280" }}>Active records</p>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "#0284c7", margin: "0.25rem 0" }}>
            {metrics.totalDocuments}
          </div>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "#4b5563" }}>Accessible in registry</p>
        </div>

        <div
          className="metric-card"
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.25rem",
          }}
        >
          <p className="eyebrow" style={{ margin: 0, color: "#6b7280" }}>Expiring soon</p>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: metrics.expiringSoonCount > 0 ? "#f59e0b" : "#10b981",
              margin: "0.25rem 0",
            }}
          >
            {metrics.expiringSoonCount}
          </div>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "#4b5563" }}>Contracts & permits (≤ 90d)</p>
        </div>

        <div
          className="metric-card"
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.25rem",
          }}
        >
          <p className="eyebrow" style={{ margin: 0, color: "#6b7280" }}>Retention review</p>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: metrics.pendingRetentionCount > 0 ? "#ef4444" : "#6b7280",
              margin: "0.25rem 0",
            }}
          >
            {metrics.pendingRetentionCount}
          </div>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "#4b5563" }}>Pending legal disposition</p>
        </div>
      </div>

      {/* Breakdown by Type */}
      <section style={{ marginBottom: "2rem" }}>
        <div className="section-heading">
          <p className="eyebrow">Distribution</p>
          <h2>Records by document category</h2>
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginTop: "0.75rem",
          }}
        >
          {Object.entries(metrics.typeCounts).map(([type, count]) => (
            <Link
              key={type}
              href={`/documents?type=${encodeURIComponent(type)}`}
              className="button button-secondary"
              style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}
            >
              <span>{type}</span>
              <span
                style={{
                  background: "#e0f2fe",
                  color: "#0369a1",
                  padding: "0.125rem 0.5rem",
                  borderRadius: "1rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {count}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Two Column Grid for Recent Uploads & Expiring */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {/* Recent Uploads */}
        <section aria-label="Recent uploads">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Registry activity</p>
              <h2>Recent uploads</h2>
            </div>
            <Link className="table-action" href="/documents">
              View all →
            </Link>
          </div>
          {metrics.recentUploads.length === 0 ? (
            <p className="file-unavailable">No recent uploads recorded.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Document</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.recentUploads.map((doc) => (
                    <tr key={doc.document_id}>
                      <td>
                        <span className="type-label">{doc.document_type}</span>
                      </td>
                      <td>
                        <Link className="table-action" href={`/documents/${doc.document_id}`}>
                          {doc.subject}
                        </Link>
                        {doc.document_number && (
                          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                            {doc.document_number}
                          </div>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{doc.document_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Expiring Documents */}
        <section aria-label="Upcoming expirations">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Critical dates</p>
              <h2>Expiring documents</h2>
            </div>
            <Link className="table-action" href="/reports?status=ACTIVE">
              View reports →
            </Link>
          </div>
          {metrics.expiringDocuments.length === 0 ? (
            <p className="file-unavailable">No upcoming document expirations.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Document</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.expiringDocuments.map((doc) => (
                    <tr key={doc.document_id}>
                      <td>
                        <span className="type-label">{doc.document_type}</span>
                      </td>
                      <td>
                        <Link className="table-action" href={`/documents/${doc.document_id}`}>
                          {doc.subject}
                        </Link>
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "#b45309", fontWeight: 600 }}>
                        {doc.expires_at ? new Date(doc.expires_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
