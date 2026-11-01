export default function TasksLoading() {
  return (
    <section className="tasks-container" aria-label="Loading approval tasks">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading tasks...</span>
          </div>
          <span className="skeleton-line" style={{ width: "14rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
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
        <div className="skeleton-table" aria-hidden="true">
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
