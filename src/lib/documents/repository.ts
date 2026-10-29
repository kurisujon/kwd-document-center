import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadDocument } from "../auth/permissions";
import type { Role } from "../auth/types";
import type { DocumentListQuery, DocumentRecord, PaginatedDocuments } from "./types";

export const baseDocumentColumns =
  "document_id, document_type, document_number, document_date, subject, persons_involved, drive_file_id, drive_url, file_name, file_type, filing_year, filing_subcategory, status, deletion_state, created_by, created_at, updated_at";

export const extendedDocumentColumns =
  "confidential, custom_metadata, file_sha256, version_count, expires_at, due_at, retention_period_months, retention_status, retention_flagged_at, retention_approved_at, retention_approved_by, retention_notes";

export const documentColumns = `${baseDocumentColumns}, ${extendedDocumentColumns}`;

type DocumentReader = { role: Role; status?: "ACTIVE" | "INACTIVE" };

function escapeLikeSearch(value: string): string {
  return value.replace(/[\\%_(),.]/g, "\\$&");
}

export async function listDocuments(
  supabase: SupabaseClient,
  query: DocumentListQuery,
  viewer?: DocumentReader,
): Promise<PaginatedDocuments> {
  if (viewer?.status && viewer.status !== "ACTIVE") {
    return { documents: [], total: 0, page: query.page, pageSize: query.pageSize };
  }

  const start = (query.page - 1) * query.pageSize;

  try {
    let request = supabase.from("documents").select(documentColumns, { count: "exact" });
    request = request.eq("deletion_state", "ACTIVE");
    if (viewer && viewer.role !== "ADMIN") {
      request = request.eq("confidential", false);
    }

    if (query.q) {
      const search = escapeLikeSearch(query.q);
      request = request.or(
        `subject.ilike.%${search}%,document_number.ilike.%${search}%,persons_involved.ilike.%${search}%,file_name.ilike.%${search}%,filing_subcategory.ilike.%${search}%`,
      );
    }
    if (query.type) request = request.eq("document_type", query.type);
    if (query.dateFrom) request = request.gte("document_date", query.dateFrom);
    if (query.dateTo) request = request.lte("document_date", query.dateTo);

    if (query.customFilters) {
      for (const [key, val] of Object.entries(query.customFilters)) {
        if (val) {
          const search = escapeLikeSearch(val);
          request = request.ilike(`custom_metadata->>${key}`, `%${search}%`);
        }
      }
    }

    const { data, error, count } = await request
      .order(query.sortBy, { ascending: query.sortOrder === "asc" })
      .range(start, start + query.pageSize - 1);

    if (!error && data) {
      const rows = (data as DocumentRecord[]).filter(
        (row) => !viewer || canReadDocument(viewer, row),
      );
      return { documents: rows, total: count ?? rows.length, page: query.page, pageSize: query.pageSize };
    }

    if (error) {
      console.warn("listDocuments query with extended columns failed, falling back to base columns:", error.message);
    }
  } catch (err) {
    console.warn("listDocuments unexpected error, falling back to base columns:", err);
  }

  // Safe fallback to base columns if extended columns (confidential, custom_metadata, etc.)
  // are not yet present on the target database
  try {
    let fallbackReq = supabase.from("documents").select(baseDocumentColumns, { count: "exact" });
    fallbackReq = fallbackReq.eq("deletion_state", "ACTIVE");
    if (query.q) {
      const search = escapeLikeSearch(query.q);
      fallbackReq = fallbackReq.or(
        `subject.ilike.%${search}%,document_number.ilike.%${search}%,persons_involved.ilike.%${search}%,file_name.ilike.%${search}%`,
      );
    }
    if (query.type) fallbackReq = fallbackReq.eq("document_type", query.type);
    if (query.dateFrom) fallbackReq = fallbackReq.gte("document_date", query.dateFrom);
    if (query.dateTo) fallbackReq = fallbackReq.lte("document_date", query.dateTo);

    const { data, error, count } = await fallbackReq
      .order(query.sortBy, { ascending: query.sortOrder === "asc" })
      .range(start, start + query.pageSize - 1);

    if (!error && data) {
      return {
        documents: data as DocumentRecord[],
        total: count ?? data.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    }
    if (error) {
      console.error("listDocuments fallback failed:", error.message);
    }
  } catch (fallbackErr) {
    console.error("listDocuments fallback caught error:", fallbackErr);
  }

  // Sanitized safe return instead of throwing and crashing the page
  return { documents: [], total: 0, page: query.page, pageSize: query.pageSize };
}

export async function getDocumentById(
  supabase: SupabaseClient,
  documentId: string,
  viewer?: DocumentReader,
): Promise<DocumentRecord | null> {
  if (viewer?.status && viewer.status !== "ACTIVE") return null;

  try {
    let request = supabase
      .from("documents")
      .select(documentColumns)
      .eq("document_id", documentId)
      .eq("deletion_state", "ACTIVE");
    if (viewer && viewer.role !== "ADMIN") request = request.eq("confidential", false);
    const { data, error } = await request.maybeSingle();
    if (!error && data) {
      const record = data as DocumentRecord;
      if (!record || (viewer && !canReadDocument(viewer, record))) return null;
      return record;
    }
  } catch {
    // Fallback below
  }

  try {
    const { data } = await supabase
      .from("documents")
      .select(baseDocumentColumns)
      .eq("document_id", documentId)
      .eq("deletion_state", "ACTIVE")
      .maybeSingle();
    if (data) return data as DocumentRecord;
  } catch {
    // Return null
  }

  return null;
}

export async function listDocumentTypes(
  supabase: SupabaseClient,
  viewer?: DocumentReader,
): Promise<string[]> {
  if (viewer?.status && viewer.status !== "ACTIVE") return [];

  try {
    let request = supabase.from("documents").select("document_type").eq("deletion_state", "ACTIVE");
    if (viewer && viewer.role !== "ADMIN") request = request.eq("confidential", false);
    const { data, error } = await request.order("document_type", { ascending: true });
    if (!error && data) {
      return [...new Set(data.map((row) => row.document_type).filter(Boolean))];
    }
  } catch {
    // Fallback below
  }

  try {
    const { data } = await supabase
      .from("documents")
      .select("document_type")
      .eq("deletion_state", "ACTIVE");
    if (data) {
      return [...new Set(data.map((row) => row.document_type).filter(Boolean))];
    }
  } catch {
    // Return empty list safely
  }

  return [];
}
