import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentListQuery, DocumentRecord, PaginatedDocuments } from "./types";

const documentColumns = "document_id, document_type, document_number, document_date, subject, persons_involved, drive_file_id, drive_url, file_name, file_type, status, created_by, created_at, updated_at";

function escapeLikeSearch(value: string): string {
  return value.replace(/[\\%_(),.]/g, "\\$&");
}

export async function listDocuments(supabase: SupabaseClient, query: DocumentListQuery): Promise<PaginatedDocuments> {
  let request = supabase.from("documents").select(documentColumns, { count: "exact" });

  if (query.q) {
    const search = escapeLikeSearch(query.q);
    request = request.or(`subject.ilike.%${search}%,document_number.ilike.%${search}%,persons_involved.ilike.%${search}%`);
  }
  if (query.type) request = request.eq("document_type", query.type);
  if (query.dateFrom) request = request.gte("document_date", query.dateFrom);
  if (query.dateTo) request = request.lte("document_date", query.dateTo);

  const start = (query.page - 1) * query.pageSize;
  const { data, error, count } = await request
    .order(query.sortBy, { ascending: query.sortOrder === "asc" })
    .range(start, start + query.pageSize - 1);

  if (error) throw new Error("Unable to retrieve documents.");
  return { documents: (data ?? []) as DocumentRecord[], total: count ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getDocumentById(supabase: SupabaseClient, documentId: string): Promise<DocumentRecord | null> {
  const { data, error } = await supabase.from("documents").select(documentColumns).eq("document_id", documentId).maybeSingle();
  if (error) throw new Error("Unable to retrieve document.");
  return data as DocumentRecord | null;
}

export async function listDocumentTypes(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("documents").select("document_type").order("document_type", { ascending: true });
  if (error) throw new Error("Unable to retrieve document types.");
  return [...new Set((data ?? []).map((row) => row.document_type).filter(Boolean))];
}
