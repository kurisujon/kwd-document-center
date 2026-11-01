export default function FoldersLoading() {
  return (
    <section className="folders-page" aria-label="Loading folder destinations">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading folder destinations...</span>
          </div>
          <span className="skeleton-line" style={{ width: "18rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
        </div>
      </header>

      {/* Access note skeleton */}
      <div className="skeleton-card" style={{ minHeight: "3.5rem", marginBlock: "1rem" }} aria-hidden="true" />

      {/* Filter / actions bar */}
      <div style={{ display: "flex", gap: "1rem", marginBlock: "1rem", flexWrap: "wrap" }} aria-hidden="true">
        <span className="skeleton-line" style={{ width: "14rem", height: "2.2rem" }} />
        <span className="skeleton-line" style={{ width: "10rem", height: "2.2rem" }} />
      </div>

      {/* Destinations table skeleton */}
      <section className="results-section" aria-hidden="true">
        <div className="skeleton-table">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <span className="skeleton-line" style={{ width: "12rem", height: "1.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "5rem", height: "1rem", marginBottom: 0 }} />
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
