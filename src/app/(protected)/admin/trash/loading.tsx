export default function TrashLoading() {
  return (
    <section className="trash-page" aria-label="Loading trash">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading trash...</span>
          </div>
          <span className="skeleton-line" style={{ width: "12rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
        </div>
      </header>

      <section className="results-section" aria-hidden="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <span className="skeleton-line" style={{ width: "10rem", height: "1.5rem" }} />
          <span className="skeleton-line" style={{ width: "6rem", height: "1.2rem" }} />
        </div>
        <div className="skeleton-table">
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
