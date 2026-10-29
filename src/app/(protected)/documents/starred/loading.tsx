export default function StarredLoading() {
  return (
    <section className="starred-container" aria-label="Loading starred documents">
      <span className="skeleton-line" style={{ width: "10rem", height: "1rem", marginBottom: "1rem" }} />
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "8rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "16rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "22rem", height: "1rem" }} />
        </div>
      </header>

      <section className="results-section">
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
