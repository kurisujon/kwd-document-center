export default function TasksLoading() {
  return (
    <section className="tasks-container" aria-label="Loading approval tasks">
      <span className="skeleton-line" style={{ width: "9rem", height: "1rem", marginBottom: "1rem" }} />
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "10rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "14rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "24rem", height: "1rem" }} />
        </div>
      </header>

      <section className="results-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }} aria-hidden="true">
          <span className="skeleton-line" style={{ width: "12rem", height: "1.5rem" }} />
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <span className="skeleton-line" style={{ width: "14rem", height: "2.2rem" }} />
            <span className="skeleton-line" style={{ width: "10rem", height: "2.2rem" }} />
          </div>
        </div>
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
