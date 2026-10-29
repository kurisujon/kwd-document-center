export default function DocumentsLoading() {
  return (
    <>
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "10rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "16rem", height: "2.2rem", margin: "0.5rem 0" }} />
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
        <div className="skeleton-table" />
      </section>
    </>
  );
}
