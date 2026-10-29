export default function ReportsLoading() {
  return (
    <section className="reports-container" aria-label="Loading reports">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "10rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "18rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "26rem", height: "1rem" }} />
        </div>
      </header>

      {/* Filter panel skeleton */}
      <section className="search-panel" aria-hidden="true" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
          <div className="skeleton-card" style={{ minHeight: "4rem" }} />
        </div>
      </section>

      {/* Table skeleton */}
      <section className="results-section">
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
