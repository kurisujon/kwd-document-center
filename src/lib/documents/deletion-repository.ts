import type { SupabaseClient } from "@supabase/supabase-js";

export type DeletionClaim = {
  outcome: "CLAIMED" | "ALREADY_DELETED" | "IN_PROGRESS" | "NOT_FOUND";
  drive_file_id: string | null;
  operation_token: string | null;
};

export class DeletionRepositoryError extends Error {
  constructor(readonly code: "REGISTRY") { super("Document deletion registry operation failed."); }
}

export function createDeletionRepository(supabase: Pick<SupabaseClient, "rpc">) {
  return {
    async claim(documentId: string, actorId: string, operationToken: string): Promise<DeletionClaim> {
      const { data, error } = await supabase.rpc("admin_claim_document_deletion", {
        p_document_id: documentId, p_actor_id: actorId, p_operation_token: operationToken, p_lease_seconds: 60,
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new DeletionRepositoryError("REGISTRY");
      return data[0] as DeletionClaim;
    },
    async finalize(documentId: string, actorId: string, operationToken: string, driveTrashed: boolean): Promise<boolean> {
      const { data, error } = await supabase.rpc("admin_finalize_document_deletion", {
        p_document_id: documentId, p_actor_id: actorId, p_operation_token: operationToken, p_drive_trashed: driveTrashed,
      });
      if (error || typeof data !== "boolean") throw new DeletionRepositoryError("REGISTRY");
      return data;
    },
    async fail(documentId: string, actorId: string, operationToken: string, category: "DRIVE_PERMISSION" | "DRIVE_UNAVAILABLE" | "DRIVE_UNKNOWN" | "REGISTRY_FINALIZATION"): Promise<boolean> {
      const { data, error } = await supabase.rpc("admin_mark_document_delete_failed", {
        p_document_id: documentId, p_actor_id: actorId, p_operation_token: operationToken, p_error_category: category,
      });
      if (error || typeof data !== "boolean") throw new DeletionRepositoryError("REGISTRY");
      return data;
    },
  };
}

export type DeletionRepository = ReturnType<typeof createDeletionRepository>;
