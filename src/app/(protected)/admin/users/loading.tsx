export default function UsersLoading() {
  return (
    <section className="users-page" aria-label="Loading authorized users">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "9rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "12rem", height: "2.2rem", margin: "0.5rem 0" }} />
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
      <section className="results-section">
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
