import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadDocument } from "../auth/permissions";
import type { AuthorizedUser } from "../auth/types";
import type { DocumentCommentRecord } from "../documents/types";

export async function addDocumentComment(
  supabase: SupabaseClient,
  actor: AuthorizedUser,
  documentId: string,
  content: string,
): Promise<DocumentCommentRecord> {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 2000) {
    throw new Error("Comment must be between 1 and 2000 characters.");
  }

  const { data, error } = await supabase.rpc("add_document_comment", {
    p_actor_id: actor.id,
    p_document_id: documentId,
    p_content: trimmed,
  });

  if (error) {
    throw new Error(error.message || "FAILED_TO_ADD_COMMENT");
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row.id,
    document_id: row.document_id,
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    user_role: row.user_role,
    content: row.content,
    created_at: row.created_at,
  };
}

export async function listDocumentComments(
  supabase: SupabaseClient,
  actor: AuthorizedUser,
  documentId: string,
): Promise<DocumentCommentRecord[]> {
  // First fetch the document to check accessibility with canReadDocument
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("document_id, deletion_state, confidential")
    .eq("document_id", documentId)
    .maybeSingle();

  if (docError || !doc) {
    return [];
  }

  if (!canReadDocument(actor, doc)) {
    return [];
  }

  const { data, error } = await supabase
    .from("document_comments")
    .select(`
      id,
      document_id,
      user_id,
      content,
      created_at,
      user:users (
        name,
        email,
        role
      )
    `)
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list comments: ${error.message}`);
  }

  interface RawCommentRow {
    id: string;
    document_id: string;
    user_id: string;
    content: string;
    created_at: string;
    user?: {
      name?: string | null;
      email?: string | null;
      role?: string | null;
    } | null;
  }

  return ((data as unknown as RawCommentRow[]) ?? []).map((row) => ({
    id: row.id,
    document_id: row.document_id,
    user_id: row.user_id,
    user_name: row.user?.name ?? "Unknown User",
    user_email: row.user?.email ?? "",
    user_role: row.user?.role ?? "STAFF",
    content: row.content,
    created_at: row.created_at,
  }));
}
