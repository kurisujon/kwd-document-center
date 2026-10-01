import type { SupabaseClient } from "@supabase/supabase-js";

export type FolderClaim = { outcome: "CLAIMED" | "ACTIVE" | "IN_PROGRESS" | "DUPLICATE_NAME"; folder_id: string | null; drive_folder_id: string | null; operation_token: string | null };
export type FolderFailureCategory = "DRIVE_PERMISSION" | "DRIVE_UNAVAILABLE" | "DRIVE_NOT_FOUND" | "DRIVE_UNKNOWN" | "REGISTRY_FINALIZATION";

export function createFolderRepository(supabase: Pick<SupabaseClient, "rpc">) {
  return {
    async claim(input: { actorId: string; idempotencyKey: string; logicalParentKey: string; driveParentId: string; name: string; normalizedName: string; operationToken: string }): Promise<FolderClaim> {
      const { data, error } = await supabase.rpc("admin_claim_document_folder_creation", { p_actor_id: input.actorId, p_idempotency_key: input.idempotencyKey, p_logical_parent_key: input.logicalParentKey, p_drive_parent_id: input.driveParentId, p_name: input.name, p_normalized_name: input.normalizedName, p_operation_token: input.operationToken, p_lease_seconds: 60 });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error("Folder registry is unavailable.");
      return data[0] as FolderClaim;
    },
    async persistDriveId(folderId: string, actorId: string, token: string, driveFolderId: string) {
      const { data, error } = await supabase.rpc("admin_set_document_folder_drive_id", { p_folder_id: folderId, p_actor_id: actorId, p_operation_token: token, p_drive_folder_id: driveFolderId });
      if (error || typeof data !== "boolean") throw new Error("Folder registry is unavailable.");
      return data;
    },
    async finalize(folderId: string, actorId: string, token: string) {
      const { data, error } = await supabase.rpc("admin_finalize_document_folder_creation", { p_folder_id: folderId, p_actor_id: actorId, p_operation_token: token });
      if (error || typeof data !== "boolean") throw new Error("Folder registry is unavailable.");
      return data;
    },
    async fail(folderId: string, actorId: string, token: string, category: FolderFailureCategory) {
      const { data, error } = await supabase.rpc("admin_mark_document_folder_failed", { p_folder_id: folderId, p_actor_id: actorId, p_operation_token: token, p_error_category: category });
      if (error || typeof data !== "boolean") throw new Error("Folder registry is unavailable.");
      return data;
    },
  };
}
export type FolderRepository = ReturnType<typeof createFolderRepository>;
