export default function DashboardLoading() {
  return (
    <section className="dashboard-container" aria-label="Loading dashboard">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "8rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "16rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
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
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem", marginTop: "1.5rem" }}>
        <div className="skeleton-table" style={{ minHeight: "14rem" }} />
        <div className="skeleton-table" style={{ minHeight: "14rem" }} />
      </div>
    </section>
  );
}
