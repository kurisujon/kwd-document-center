export default function DashboardLoading() {
  return (
    <section className="dashboard-container" aria-label="Loading dashboard">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading dashboard...</span>
          </div>
          <span className="skeleton-line" style={{ width: "16rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "26rem", height: "1rem" }} />
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
        aria-hidden="true"
      >
        <div className="skeleton-card">
          <span className="skeleton-line" style={{ width: "6rem", height: "0.75rem", marginBottom: "0.6rem" }} />
          <span className="skeleton-line" style={{ width: "4rem", height: "2.2rem", marginBottom: "0.6rem" }} />
          <span className="skeleton-line" style={{ width: "10rem", height: "0.75rem", marginBottom: 0 }} />
        </div>
        <div className="skeleton-card">
          <span className="skeleton-line" style={{ width: "6rem", height: "0.75rem", marginBottom: "0.6rem" }} />
          <span className="skeleton-line" style={{ width: "4rem", height: "2.2rem", marginBottom: "0.6rem" }} />
          <span className="skeleton-line" style={{ width: "10rem", height: "0.75rem", marginBottom: 0 }} />
        </div>
        <div className="skeleton-card">
          <span className="skeleton-line" style={{ width: "6rem", height: "0.75rem", marginBottom: "0.6rem" }} />
          <span className="skeleton-line" style={{ width: "4rem", height: "2.2rem", marginBottom: "0.6rem" }} />
          <span className="skeleton-line" style={{ width: "10rem", height: "0.75rem", marginBottom: 0 }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem", marginTop: "1.5rem" }} aria-hidden="true">
        <div className="skeleton-table">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <span className="skeleton-line" style={{ width: "9rem", height: "1.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "4rem", height: "1rem", marginBottom: 0 }} />
          </div>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
          </div>
        </div>
        <div className="skeleton-table">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <span className="skeleton-line" style={{ width: "9rem", height: "1.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "4rem", height: "1rem", marginBottom: 0 }} />
          </div>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
          </div>
        </div>
      </div>
    </section>
  );
}
