export default function UploadLoading() {
  return (
    <section className="upload-page" aria-label="Loading upload workspace">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <div className="skeleton-status-badge" role="status">
            <span className="skeleton-pulse-dot" aria-hidden="true" />
            <span>Loading upload center...</span>
          </div>
          <span className="skeleton-line" style={{ width: "18rem", height: "2.2rem", margin: "0.25rem 0 0.5rem" }} />
          <span className="skeleton-line" style={{ width: "28rem", height: "1rem" }} />
        </div>
      </header>

      {/* Upload dropzone and form skeleton */}
      <div className="skeleton-card" style={{ minHeight: "14rem", marginBlock: "1.5rem" }} aria-hidden="true" />
      <div className="skeleton-table" style={{ minHeight: "12rem" }} aria-hidden="true" />
    </section>
  );
}
