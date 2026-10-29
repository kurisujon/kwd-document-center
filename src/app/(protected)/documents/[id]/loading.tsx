export default function DocumentDetailLoading() {
  return (
    <section className="document-detail-container" aria-label="Loading document detail">
      <span className="skeleton-line" style={{ width: "9rem", height: "1rem", marginBottom: "1rem" }} />
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "8rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "20rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "16rem", height: "1rem" }} />
        </div>
      </header>

      {/* Detail grid skeleton */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.25rem",
          marginBlock: "1.5rem",
        }}
        aria-hidden="true"
      >
        <div className="skeleton-card" style={{ minHeight: "12rem" }} />
        <div className="skeleton-card" style={{ minHeight: "12rem" }} />
      </div>

      <section className="document-detail" aria-label="Loading document content">
        <div className="skeleton-detail" />
      </section>
    </section>
  );
}
