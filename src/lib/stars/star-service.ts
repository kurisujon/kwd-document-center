import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedUser } from "../auth/types";
import { documentColumns } from "../documents/repository";
import type { DocumentRecord, PaginatedDocuments } from "../documents/types";

export async function toggleDocumentStar(
  supabase: SupabaseClient,
  userId: string,
  documentId: string,
): Promise<{ documentId: string; starred: boolean }> {
  const { data, error } = await supabase.rpc("toggle_document_star", {
    p_actor_id: userId,
    p_document_id: documentId,
  });

  if (error) {
    throw new Error(error.message || "STAR_TOGGLE_FAILED");
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    documentId: row.document_id,
    starred: Boolean(row.starred),
  };
}

export async function isDocumentStarred(
  supabase: SupabaseClient,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_document_stars")
    .select("id")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .maybeSingle();

  if (error || !data) return false;
  return true;
}

export async function listStarredDocuments(
  supabase: SupabaseClient,
  user: AuthorizedUser,
  options?: { page?: number; pageSize?: number },
): Promise<PaginatedDocuments> {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("user_document_stars")
    .select(`
      created_at,
      document:documents!inner (
        ${documentColumns}
      )
    `, { count: "exact" })
    .eq("user_id", user.id)
    .eq("document.deletion_state", "ACTIVE");

  if (user.role !== "ADMIN") {
    query = query.eq("document.confidential", false);
  }

  query = query.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to list starred documents: ${error.message}`);
  }

  interface StarredRow {
    created_at: string;
    document: DocumentRecord;
  }

  const documents = ((data as unknown as StarredRow[]) ?? [])
    .map((row) => row.document)
    .filter(Boolean);

  return {
    documents,
    total: count ?? 0,
    page,
    pageSize,
  };
}
