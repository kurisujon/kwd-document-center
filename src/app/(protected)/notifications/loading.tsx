export default function NotificationsLoading() {
  return (
    <section className="notifications-container" aria-label="Loading notifications">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "9rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "15rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "22rem", height: "1rem" }} />
        </div>
      </header>

      {/* Pill buttons skeleton */}
      <div style={{ marginBlock: "1rem", display: "flex", gap: "0.5rem" }} aria-hidden="true">
        <span className="skeleton-line" style={{ width: "5rem", height: "2.2rem", borderRadius: "9999px" }} />
        <span className="skeleton-line" style={{ width: "6rem", height: "2.2rem", borderRadius: "9999px" }} />
      </div>

      {/* Table skeleton */}
      <section className="results-section">
        <div className="skeleton-table" />
      </section>
    </section>
  );
}
