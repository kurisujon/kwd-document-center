import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadDocument } from "../auth/permissions";
import type { Role } from "../auth/types";
import type { DocumentListQuery, DocumentRecord, PaginatedDocuments } from "./types";

export const documentColumns = "document_id, document_type, document_number, document_date, subject, persons_involved, drive_file_id, drive_url, file_name, file_type, filing_year, filing_subcategory, status, deletion_state, confidential, created_by, created_at, updated_at";

type DocumentReader = { role: Role; status?: "ACTIVE" | "INACTIVE" };

function escapeLikeSearch(value: string): string {
  return value.replace(/[\\%_(),.]/g, "\\$&");
}

export async function listDocuments(supabase: SupabaseClient, query: DocumentListQuery, viewer?: DocumentReader): Promise<PaginatedDocuments> {
  if (viewer?.status && viewer.status !== "ACTIVE") return { documents: [], total: 0, page: query.page, pageSize: query.pageSize };
  let request = supabase.from("documents").select(documentColumns, { count: "exact" });
  request = request.eq("deletion_state", "ACTIVE");
  if (viewer && viewer.role !== "ADMIN") request = request.eq("confidential", false);

  if (query.q) {
    const search = escapeLikeSearch(query.q);
    request = request.or(`subject.ilike.%${search}%,document_number.ilike.%${search}%,persons_involved.ilike.%${search}%,file_name.ilike.%${search}%,filing_subcategory.ilike.%${search}%`);
  }
  if (query.type) request = request.eq("document_type", query.type);
  if (query.dateFrom) request = request.gte("document_date", query.dateFrom);
  if (query.dateTo) request = request.lte("document_date", query.dateTo);

  const start = (query.page - 1) * query.pageSize;
  const { data, error, count } = await request
    .order(query.sortBy, { ascending: query.sortOrder === "asc" })
    .range(start, start + query.pageSize - 1);

  if (error) throw new Error("Unable to retrieve documents.");
  const rows = ((data ?? []) as DocumentRecord[]).filter((row) => !viewer || canReadDocument(viewer, row));
  return { documents: rows, total: count ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getDocumentById(supabase: SupabaseClient, documentId: string, viewer?: DocumentReader): Promise<DocumentRecord | null> {
  if (viewer?.status && viewer.status !== "ACTIVE") return null;
  let request = supabase.from("documents").select(documentColumns).eq("document_id", documentId).eq("deletion_state", "ACTIVE");
  if (viewer && viewer.role !== "ADMIN") request = request.eq("confidential", false);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error("Unable to retrieve document.");
  const record = data as DocumentRecord | null;
  if (!record || (viewer && !canReadDocument(viewer, record))) return null;
  return record;
}

export async function listDocumentTypes(supabase: SupabaseClient, viewer?: DocumentReader): Promise<string[]> {
  if (viewer?.status && viewer.status !== "ACTIVE") return [];
  let request = supabase.from("documents").select("document_type").eq("deletion_state", "ACTIVE");
  if (viewer && viewer.role !== "ADMIN") request = request.eq("confidential", false);
  const { data, error } = await request.order("document_type", { ascending: true });
  if (error) throw new Error("Unable to retrieve document types.");
  return [...new Set((data ?? []).map((row) => row.document_type).filter(Boolean))];
}
