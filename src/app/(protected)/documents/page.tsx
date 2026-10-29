import Link from "next/link";
import { requireAuthorizedUser } from "@/lib/auth/server";
import { parseDocumentListQuery } from "@/lib/documents/query";
import { listDocuments, listDocumentTypes } from "@/lib/documents/repository";
import type { DocumentListQuery, DocumentSortField, PaginatedDocuments } from "@/lib/documents/types";
import { createClient } from "@/lib/supabase/server";
import { DocumentDeleteAction } from "@/components/documents/document-delete-action";
import { DocumentPageActions } from "@/components/documents/document-page-actions";

function queryHref(query: DocumentListQuery, updates: Partial<Record<keyof DocumentListQuery, string | number | undefined>>) {
  const params = new URLSearchParams();
  const values = { ...query, ...updates };
  if (values.q) params.set("q", String(values.q));
  if (values.type) params.set("type", String(values.type));
  if (values.dateFrom) params.set("dateFrom", String(values.dateFrom));
  if (values.dateTo) params.set("dateTo", String(values.dateTo));
  if (values.page !== 1) params.set("page", String(values.page));
  if (values.pageSize !== 25) params.set("pageSize", String(values.pageSize));
  if (values.sortBy !== "created_at") params.set("sortBy", String(values.sortBy));
  if (values.sortOrder !== "desc") params.set("sortOrder", String(values.sortOrder));
  const search = params.toString();
  return search ? `/documents?${search}` : "/documents";
}

function SortHeader({ label, field, query }: { label: string; field: DocumentSortField; query: DocumentListQuery }) {
  const isCurrent = query.sortBy === field;
  const nextOrder = isCurrent && query.sortOrder === "asc" ? "desc" : "asc";
  return <th aria-sort={isCurrent ? (query.sortOrder === "asc" ? "ascending" : "descending") : "none"}><Link className="sort-link" href={queryHref(query, { sortBy: field, sortOrder: nextOrder, page: 1 })}>{label}{isCurrent && <span aria-hidden="true"> {query.sortOrder === "asc" ? "↑" : "↓"}</span>}</Link></th>;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAuthorizedUser();
  const validation = parseDocumentListQuery(await searchParams);
  if (!validation.success) {
    return <section className="registry-error" role="alert"><h1>Documents</h1><p>{validation.message}</p><Link className="button button-secondary" href="/documents">Clear filters</Link></section>;
  }

  const query = validation.data;
  let result: PaginatedDocuments | undefined;
  let documentTypes: string[] | undefined;
  let loadFailed = false;
  try {
    const supabase = await createClient();
    [result, documentTypes] = await Promise.all([listDocuments(supabase, query, user), listDocumentTypes(supabase, user)]);
  } catch {
    loadFailed = true;
  }
  if (loadFailed || !result || !documentTypes) return <section className="registry-error" role="alert"><h1>Documents unavailable</h1><p>We could not load the document registry. Please try again.</p><Link className="button button-secondary" href="/documents">Retry</Link></section>;

  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const activeFilterCount = [query.q, query.type, query.dateFrom, query.dateTo].filter(Boolean).length;
  return <>
      <header className="page-heading"><div><p className="eyebrow">Document workspace</p><h1>Find the document you need.</h1><p>Search the official KWD registry, narrow the results, and open the source file in Drive.</p></div><DocumentPageActions role={user.role} /></header>
      <section className="workspace-overview" aria-label="Document registry overview"><div><span className="overview-label">Registry</span><strong>{result.total.toLocaleString()}</strong><span>matching {result.total === 1 ? "document" : "documents"}</span></div><div><span className="overview-label">Current view</span><strong>{activeFilterCount || "All"}</strong><span>{activeFilterCount ? `${activeFilterCount} active ${activeFilterCount === 1 ? "filter" : "filters"}` : "No filters applied"}</span></div><div className="overview-guidance"><span className="overview-label">Quick guidance</span><strong>Search first</strong><span>Use a number, subject, person, or filename.</span></div></section>
      <form className="search-panel" aria-label="Document filters">
        <div className="filter-heading"><div><p className="eyebrow">Registry search</p><h2>Search and filter</h2></div>{activeFilterCount > 0 && <Link className="clear-filter" href="/documents">Clear all</Link>}</div>
        <label className="field search-field">Search documents<input name="q" type="search" defaultValue={query.q} placeholder="Search by number, subject, or person" /></label>
        <label className="field">Document type<select name="type" defaultValue={query.type ?? ""}><option value="">All document types</option>{documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="field">From date<input name="dateFrom" type="date" defaultValue={query.dateFrom} /></label>
        <label className="field">To date<input name="dateTo" type="date" defaultValue={query.dateTo} /></label>
        <input name="sortBy" type="hidden" value={query.sortBy} />
        <input name="sortOrder" type="hidden" value={query.sortOrder} />
        <button className="button button-secondary filter-submit" type="submit">Apply filters</button>
      </form>
      <section className="results-section" aria-labelledby="results-title"><div className="results-heading"><div><p className="eyebrow">Registry results</p><h2 id="results-title">Documents</h2></div><span>{result.total.toLocaleString()} total</span></div><div className="table-wrap" aria-label="Document results"><table><thead><tr><SortHeader label="Document number" field="document_number" query={query} /><SortHeader label="Type" field="document_type" query={query} /><SortHeader label="Date" field="document_date" query={query} /><SortHeader label="Subject" field="subject" query={query} /><th>Actions</th></tr></thead><tbody>{result.documents.length === 0 ? <tr><td colSpan={5} className="empty-state"><strong>No documents found.</strong><span>Try adjusting your search or filters.</span></td></tr> : result.documents.map((document) => <tr key={document.document_id}><td><strong>{document.document_number ?? "—"}</strong></td><td><span className="type-label">{document.document_type}</span>{document.confidential && <> <span className="type-label">Confidential</span></>}</td><td>{document.document_date}</td><td className="subject-cell">{document.subject}</td><td><div className="row-actions"><Link className="table-action" href={`/documents/${document.document_id}`}>View<span className="sr-only"> {document.subject}</span></Link>{user.role === "ADMIN" && <DocumentDeleteAction id={document.document_id} number={document.document_number} subject={document.subject} />}</div></td></tr>)}</tbody></table></div></section>
      <nav className="pagination" aria-label="Document pages"><span>Showing {result.documents.length === 0 ? 0 : (result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.total)} of {result.total}</span><div>{result.page > 1 && <Link className="button button-secondary" href={queryHref(query, { page: result.page - 1 })}>Previous</Link>}{result.page < pageCount && <Link className="button button-secondary" href={queryHref(query, { page: result.page + 1 })}>Next</Link>}</div></nav>
    </>;
}
