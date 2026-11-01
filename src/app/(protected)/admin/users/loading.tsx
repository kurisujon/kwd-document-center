export default function UsersLoading() {
  return (
    <section className="users-page" aria-label="Loading authorized users">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading authorized users...</span>
          </div>
          <span className="skeleton-line" style={{ width: "12rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "20rem", height: "1rem" }} />
        </div>
      </header>

      {/* Toolbar / Search skeleton */}
      <div style={{ display: "flex", gap: "1rem", marginBlock: "1.25rem", flexWrap: "wrap" }} aria-hidden="true">
        <span className="skeleton-line" style={{ width: "16rem", height: "2.4rem" }} />
        <span className="skeleton-line" style={{ width: "10rem", height: "2.4rem" }} />
        <span className="skeleton-line" style={{ width: "10rem", height: "2.4rem" }} />
      </div>

      {/* Table skeleton */}
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
