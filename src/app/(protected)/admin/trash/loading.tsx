export default function TrashLoading() {
  return (
    <section className="trash-page" aria-label="Loading trash">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "8rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "12rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
        </div>
      </header>

      <section className="results-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }} aria-hidden="true">
          <span className="skeleton-line" style={{ width: "10rem", height: "1.5rem" }} />
          <span className="skeleton-line" style={{ width: "6rem", height: "1.2rem" }} />
        </div>
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
