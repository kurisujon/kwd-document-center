import type { SupabaseClient } from "@supabase/supabase-js";

export type SoftDeleteOutcome = "DELETED" | "ALREADY_DELETED" | "IN_PROGRESS" | "NOT_FOUND";

export type PurgeClaim = {
  outcome: "CLAIMED" | "ALREADY_PURGED" | "NOT_DELETED" | "IN_PROGRESS" | "NOT_FOUND";
  drive_file_id: string | null;
  operation_token: string | null;
};

export type RestorePreparation = {
  outcome:
    | "RESTORED"
    | "NEEDS_DRIVE_UNTRASH"
    | "ALREADY_ACTIVE"
    | "ALREADY_PURGED"
    | "IN_PROGRESS"
    | "NOT_FOUND";
  drive_file_id: string | null;
  needs_drive_untrash: boolean;
};

export type TrashedDocumentRecord = {
  document_id: string;
  document_type: string;
  document_number: string | null;
  document_date: string;
  subject: string;
  file_name: string | null;
  file_type: string | null;
  confidential: boolean;
  deletion_state: "DELETED" | "DELETE_FAILED";
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_by_email: string | null;
  drive_trashed_at: string | null;
  delete_error_category: string | null;
};

export class DeletionRepositoryError extends Error {
  constructor(readonly code: "REGISTRY") {
    super("Document deletion registry operation failed.");
  }
}

export function createDeletionRepository(supabase: Pick<SupabaseClient, "rpc">) {
  return {
    async softDelete(documentId: string, actorId: string): Promise<{ outcome: SoftDeleteOutcome }> {
      const { data, error } = await supabase.rpc("admin_soft_delete_document", {
        p_document_id: documentId,
        p_actor_id: actorId,
      });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data[0] as { outcome: SoftDeleteOutcome };
    },

    async listTrashed(actorId: string): Promise<TrashedDocumentRecord[]> {
      const { data, error } = await supabase.rpc("admin_list_trashed_documents", {
        p_actor_id: actorId,
      });
      if (error || !Array.isArray(data)) {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data as TrashedDocumentRecord[];
    },

    async prepareRestore(documentId: string, actorId: string): Promise<RestorePreparation> {
      const { data, error } = await supabase.rpc("admin_prepare_document_restore", {
        p_document_id: documentId,
        p_actor_id: actorId,
      });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data[0] as RestorePreparation;
    },

    async completeRestore(documentId: string, actorId: string): Promise<boolean> {
      const { data, error } = await supabase.rpc("admin_complete_document_restore", {
        p_document_id: documentId,
        p_actor_id: actorId,
      });
      if (error || typeof data !== "boolean") {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data;
    },

    async claimPurge(
      documentId: string,
      actorId: string,
      operationToken: string,
    ): Promise<PurgeClaim> {
      const { data, error } = await supabase.rpc("admin_claim_document_purge", {
        p_document_id: documentId,
        p_actor_id: actorId,
        p_operation_token: operationToken,
        p_lease_seconds: 60,
      });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data[0] as PurgeClaim;
    },

    async finalizePurge(
      documentId: string,
      actorId: string,
      operationToken: string,
      driveTrashed: boolean,
      reason: string,
    ): Promise<boolean> {
      const { data, error } = await supabase.rpc("admin_finalize_document_purge", {
        p_document_id: documentId,
        p_actor_id: actorId,
        p_operation_token: operationToken,
        p_drive_trashed: driveTrashed,
        p_reason: reason,
      });
      if (error || typeof data !== "boolean") {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data;
    },

    async fail(
      documentId: string,
      actorId: string,
      operationToken: string,
      category:
        | "DRIVE_PERMISSION"
        | "DRIVE_UNAVAILABLE"
        | "DRIVE_UNKNOWN"
        | "REGISTRY_FINALIZATION",
    ): Promise<boolean> {
      const { data, error } = await supabase.rpc("admin_mark_document_delete_failed", {
        p_document_id: documentId,
        p_actor_id: actorId,
        p_operation_token: operationToken,
        p_error_category: category,
      });
      if (error || typeof data !== "boolean") {
        throw new DeletionRepositoryError("REGISTRY");
      }
      return data;
    },
  };
}

export type DeletionRepository = ReturnType<typeof createDeletionRepository>;
