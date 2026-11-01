export default function DocumentsLoading() {
  return (
    <>
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading documents...</span>
          </div>
          <span className="skeleton-line" style={{ width: "16rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
        </div>
      </header>
      <div className="bento-grid" aria-hidden="true">
        <div className="search-panel bento-tile bento-search loading-fields">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="bento-tile bento-stat loading-fields">
          <span />
        </div>
        <div className="bento-tile bento-stat loading-fields">
          <span />
        </div>
        <div className="bento-tile bento-guidance loading-fields">
          <span />
        </div>
      </div>
      <section className="results-section bento-tile" aria-label="Loading document results">
        <div className="skeleton-table">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <span className="skeleton-line" style={{ width: "10rem", height: "1.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "6rem", height: "1rem", marginBottom: 0 }} />
          </div>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
            <span className="skeleton-line" style={{ width: "100%", height: "2.25rem", marginBottom: 0 }} />
          </div>
        </div>
      </section>
    </>
  );
}
