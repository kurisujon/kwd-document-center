export default function AuditLogLoading() {
  return (
    <section className="audit-log-page" aria-label="Loading audit logs">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading audit log...</span>
          </div>
          <span className="skeleton-line" style={{ width: "14rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
        </div>
      </header>

      {/* Filter panel skeleton */}
      <section className="search-panel" aria-hidden="true" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
        </div>
      </section>

      {/* Table skeleton */}
      <section className="results-section" aria-hidden="true">
        <div className="skeleton-table">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <span className="skeleton-line" style={{ width: "10rem", height: "1.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "4rem", height: "1rem", marginBottom: 0 }} />
          </div>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
          </div>
        </div>
      </section>
    </section>
  );
}
