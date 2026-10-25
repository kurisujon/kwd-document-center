export default function DocumentsLoading() {
  return <>
    <header className="page-heading"><div><p className="eyebrow">Document workspace</p><h1>Documents</h1><p>Loading the document registry.</p></div></header>
    <div className="bento-grid" aria-hidden="true">
      <div className="search-panel bento-tile bento-search loading-fields"><span /><span /><span /><span /></div>
      <div className="bento-tile bento-stat loading-fields"><span /></div>
      <div className="bento-tile bento-stat loading-fields"><span /></div>
      <div className="bento-tile bento-guidance loading-fields"><span /></div>
    </div>
    <section className="results-section bento-tile" aria-label="Loading document results"><div className="skeleton-table" /></section>
  </>;
}
