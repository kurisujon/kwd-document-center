export default function StarredLoading() {
  return (
    <section className="starred-container" aria-label="Loading starred documents">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading starred documents...</span>
          </div>
          <span className="skeleton-line" style={{ width: "16rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "22rem", height: "1rem" }} />
        </div>
      </header>

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
