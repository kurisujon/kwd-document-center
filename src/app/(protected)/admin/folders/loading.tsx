export default function FoldersLoading() {
  return (
    <section className="folders-page" aria-label="Loading folder destinations">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "8rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "18rem", height: "2.2rem", margin: "0.5rem 0" }} />
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
      <section className="results-section">
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
