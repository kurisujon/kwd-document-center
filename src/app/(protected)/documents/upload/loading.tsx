export default function UploadLoading() {
  return (
    <section className="upload-page" aria-label="Loading upload workspace">
      <header className="page-heading">
        <div style={{ width: "100%" }}>
          <span className="skeleton-line" style={{ width: "8rem", height: "0.85rem" }} />
          <span className="skeleton-line" style={{ width: "18rem", height: "2.2rem", margin: "0.5rem 0" }} />
          <span className="skeleton-line" style={{ width: "28rem", height: "1rem" }} />
        </div>
      </header>

      {/* Upload dropzone and form skeleton */}
      <div className="skeleton-card" style={{ minHeight: "14rem", marginBlock: "1.5rem" }} />
      <div className="skeleton-table" style={{ minHeight: "12rem" }} />
    </section>
  );
}
