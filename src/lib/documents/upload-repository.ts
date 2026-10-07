import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { documentColumns } from "./repository";
import type { DocumentRecord } from "./types";
import type { UploadAttempt, UploadMetadataSnapshot } from "./upload-types";

const attemptColumns = "id, idempotency_key, status, drive_file_id, operation_token, reservation_expires_at, metadata_snapshot, document_id, created_by, safe_error_code";

export type FolderUploadClaimInput = {
  actorId: string;
  idempotencyKey: string;
  destinationFolderId: string;
  sourceRelativePath: string;
  normalizedRelativePathKey: string;
  contentSha256: Uint8Array;
  metadataSnapshot: UploadMetadataSnapshot;
};

export type FolderUploadClaimOutcome = "CLAIMED" | "REPLAY" | "COMPLETE" | "DUPLICATE_PATH" | "IDEMPOTENCY_MISMATCH" | "NOT_AUTHORIZED" | "INVALID_DESTINATION" | "INVALID_REQUEST";
export type FolderUploadClaimResult = {
  outcome: FolderUploadClaimOutcome;
  attemptId: string | null;
  attemptStatus: UploadAttempt["status"] | null;
  driveFileId: string | null;
  operationToken: string | null;
  reservationExpiresAt: string | null;
  documentId: string | null;
};
export type FinalizeFolderUploadInput = { attemptId: string; actorId: string; expectedDriveFileId: string };

export class FolderUploadAttemptRepositoryError extends Error {
  constructor() { super("Folder upload state is unavailable."); }
}

export interface FolderUploadAttemptRepository {
  claimFolderUploadAttempt(input: FolderUploadClaimInput): Promise<FolderUploadClaimResult>;
  finalizeFolderUploadAttempt(input: FinalizeFolderUploadInput): Promise<DocumentRecord>;
}

function byteaLiteral(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function isClaimOutcome(value: unknown): value is FolderUploadClaimOutcome {
  return typeof value === "string" && ["CLAIMED", "REPLAY", "COMPLETE", "DUPLICATE_PATH", "IDEMPOTENCY_MISMATCH", "NOT_AUTHORIZED", "INVALID_DESTINATION", "INVALID_REQUEST"].includes(value);
}

function isUploadAttemptStatus(value: unknown): value is UploadAttempt["status"] {
  return typeof value === "string" && ["PENDING_UPLOAD", "UPLOADING", "PENDING_REGISTRY", "COMPLETE", "FAILED"].includes(value);
}

export function createFolderUploadAttemptRepository(supabase: SupabaseClient): FolderUploadAttemptRepository {
  return {
    async claimFolderUploadAttempt(input) {
      const { data, error } = await supabase.rpc("admin_claim_folder_upload_attempt", {
        p_actor_id: input.actorId,
        p_idempotency_key: input.idempotencyKey,
        p_destination_folder_id: input.destinationFolderId,
        p_source_relative_path: input.sourceRelativePath,
        p_normalized_relative_path_key: input.normalizedRelativePathKey,
        p_content_sha256: byteaLiteral(input.contentSha256),
        p_metadata_snapshot: input.metadataSnapshot,
      });
      if (error || !Array.isArray(data) || data.length !== 1 || !isClaimOutcome(data[0]?.outcome)) throw new FolderUploadAttemptRepositoryError();
      const row = data[0] as { outcome: FolderUploadClaimOutcome; attempt_id: string | null; attempt_status: UploadAttempt["status"] | null; drive_file_id: string | null; operation_token: string | null; reservation_expires_at: string | null; document_id: string | null };
      if (["CLAIMED", "REPLAY", "COMPLETE"].includes(row.outcome) && (typeof row.attempt_id !== "string" || !isUploadAttemptStatus(row.attempt_status))) throw new FolderUploadAttemptRepositoryError();
      if (row.outcome === "COMPLETE" && typeof row.document_id !== "string") throw new FolderUploadAttemptRepositoryError();
      return { outcome: row.outcome, attemptId: row.attempt_id, attemptStatus: row.attempt_status, driveFileId: row.drive_file_id, operationToken: row.operation_token, reservationExpiresAt: row.reservation_expires_at, documentId: row.document_id };
    },
    async finalizeFolderUploadAttempt(input) {
      const { data, error } = await supabase.rpc("admin_finalize_folder_upload", {
        p_attempt_id: input.attemptId,
        p_actor_id: input.actorId,
        p_expected_drive_file_id: input.expectedDriveFileId,
      });
      if (error || !data || typeof (data as { document_id?: unknown }).document_id !== "string") throw new FolderUploadAttemptRepositoryError();
      return data as DocumentRecord;
    },
  };
}

export interface UploadAttemptRepository {
  findByIdempotencyKey(key: string): Promise<UploadAttempt | null>;
  create(key: string, creatorId: string, snapshot: UploadMetadataSnapshot): Promise<UploadAttempt>;
  claimDriveIdReservation(attemptId: string, leaseDurationMs?: number): Promise<{ claimed: boolean; operationToken: string | null }>;
  clearDriveIdReservation(attemptId: string, expectedOperationToken: string): Promise<void>;
  persistDriveFileId(attemptId: string, driveFileId: string, expectedOperationToken: string): Promise<boolean>;
  resumeUpload(attemptId: string): Promise<{ resumed: boolean; operationToken: string | null }>;
  recoverInterruptedUploadToFailed(attemptId: string, expectedDriveFileId: string, expectedOperationToken: string): Promise<{ changed: boolean; attempt: UploadAttempt | null }>;
  markPendingRegistry(attemptId: string, driveFileId: string, expectedOperationToken: string): Promise<boolean>;
  markFailed(attemptId: string, expectedDriveFileId: string, expectedOperationToken: string, safeErrorCode: string): Promise<{ changed: boolean; attempt: UploadAttempt | null }>;
  finalize(attempt: UploadAttempt, creatorEmail: string): Promise<DocumentRecord>;
  getDocument(documentId: string): Promise<DocumentRecord | null>;
}

export function createUploadAttemptRepository(supabase: SupabaseClient): UploadAttemptRepository {
  return {
    async findByIdempotencyKey(key) {
      const { data, error } = await supabase.from("upload_attempts").select(attemptColumns).eq("idempotency_key", key).maybeSingle();
      if (error) throw new Error("Unable to read upload attempt.");
      return data as UploadAttempt | null;
    },
    async create(key, creatorId, snapshot) {
      const { data, error } = await supabase
        .from("upload_attempts")
        .insert({ idempotency_key: key, status: "PENDING_UPLOAD", metadata_snapshot: snapshot, created_by: creatorId })
        .select(attemptColumns)
        .single();
      if (error) throw Object.assign(new Error("Unable to create upload attempt."), { databaseCode: error.code });
      return data as UploadAttempt;
    },
    async claimDriveIdReservation(attemptId, leaseDurationMs = 60_000) {
      const operationToken = randomUUID();
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
      const { data, error } = await supabase
        .from("upload_attempts")
        .update({
          operation_token: operationToken,
          reservation_expires_at: expiresAt,
          updated_at: nowIso,
        })
        .eq("id", attemptId)
        .eq("status", "PENDING_UPLOAD")
        .is("drive_file_id", null)
        .or(`operation_token.is.null,reservation_expires_at.lte.${nowIso}`)
        .select("id");
      if (error) throw new Error("Unable to claim Drive ID reservation.");
      return { claimed: Boolean(data?.length), operationToken: data?.length ? operationToken : null };
    },
    async clearDriveIdReservation(attemptId, expectedOperationToken) {
      const { error } = await supabase
        .from("upload_attempts")
        .update({
          operation_token: null,
          reservation_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("status", "PENDING_UPLOAD")
        .eq("operation_token", expectedOperationToken);
      if (error) throw new Error("Unable to release Drive ID reservation.");
    },
    async persistDriveFileId(attemptId, driveFileId, expectedOperationToken) {
      const { data, error } = await supabase
        .from("upload_attempts")
        .update({
          status: "UPLOADING",
          drive_file_id: driveFileId,
          reservation_expires_at: null,
          safe_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("status", "PENDING_UPLOAD")
        .eq("operation_token", expectedOperationToken)
        .is("drive_file_id", null)
        .select("id");
      if (error) throw new Error("Unable to persist Drive file ID.");
      return Boolean(data?.length);
    },
    async resumeUpload(attemptId) {
      // Generate a fresh operation token for this retry. Any stale request
      // holding the previous token will no longer be able to mutate state.
      const operationToken = randomUUID();
      const { data, error } = await supabase
        .from("upload_attempts")
        .update({
          status: "UPLOADING",
          operation_token: operationToken,
          reservation_expires_at: null,
          safe_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("status", "FAILED")
        .not("drive_file_id", "is", null)
        .select("id");
      if (error) throw new Error("Unable to resume upload attempt.");
      return { resumed: Boolean(data?.length), operationToken: data?.length ? operationToken : null };
    },
    async recoverInterruptedUploadToFailed(attemptId, expectedDriveFileId, expectedOperationToken) {
      const { data, error } = await supabase
        .from("upload_attempts")
        .update({
          status: "FAILED",
          safe_error_code: "DRIVE_ERROR",
          reservation_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("status", "UPLOADING")
        .eq("drive_file_id", expectedDriveFileId)
        .eq("operation_token", expectedOperationToken)
        .select(attemptColumns)
        .maybeSingle();
      if (error) throw new Error("Unable to recover interrupted upload attempt.");
      if (data) return { changed: true, attempt: data as UploadAttempt };
      const current = await supabase.from("upload_attempts").select(attemptColumns).eq("id", attemptId).maybeSingle();
      if (current.error) throw new Error("Unable to reload upload attempt.");
      return { changed: false, attempt: current.data as UploadAttempt | null };
    },
    async markPendingRegistry(attemptId, driveFileId, expectedOperationToken) {
      const { data, error } = await supabase.from("upload_attempts").update({ status: "PENDING_REGISTRY", safe_error_code: null, updated_at: new Date().toISOString() }).eq("id", attemptId).eq("status", "UPLOADING").eq("drive_file_id", driveFileId).eq("operation_token", expectedOperationToken).select("id");
      if (error) throw new Error("Unable to preserve Drive upload state.");
      return Boolean(data?.length);
    },
    async markFailed(attemptId, expectedDriveFileId, expectedOperationToken, safeErrorCode) {
      const { data, error } = await supabase
        .from("upload_attempts")
        .update({
          status: "FAILED",
          safe_error_code: safeErrorCode,
          reservation_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("status", "UPLOADING")
        .eq("drive_file_id", expectedDriveFileId)
        .eq("operation_token", expectedOperationToken)
        .select(attemptColumns)
        .maybeSingle();
      if (error) throw new Error("Unable to update upload attempt.");
      if (data) return { changed: true, attempt: data as UploadAttempt };
      const current = await supabase.from("upload_attempts").select(attemptColumns).eq("id", attemptId).maybeSingle();
      if (current.error) throw new Error("Unable to reload upload attempt.");
      return { changed: false, attempt: current.data as UploadAttempt | null };
    },
    async finalize(attempt, creatorEmail) {
      const snapshot = attempt.metadata_snapshot;
      const { data, error } = await supabase.rpc("finalize_admin_upload", {
        attempt_id: attempt.id,
        p_document_type: snapshot.document_type,
        p_document_number: snapshot.document_number,
        p_document_date: snapshot.document_date,
        p_subject: snapshot.subject,
        p_persons_involved: snapshot.persons_involved,
        p_drive_file_id: attempt.drive_file_id,
        p_drive_url: `https://drive.google.com/file/d/${encodeURIComponent(attempt.drive_file_id ?? "")}/view`,
        p_file_name: snapshot.file_name,
        p_file_type: snapshot.file_type,
        p_filing_year: snapshot.filing_year,
        p_filing_subcategory: snapshot.filing_subcategory,
        p_created_by: creatorEmail,
      });
      if (error || !data) throw new Error("Unable to finalize registry record.");
      return data as DocumentRecord;
    },
    async getDocument(documentId) {
      const { data, error } = await supabase.from("documents").select(documentColumns).eq("document_id", documentId).maybeSingle();
      if (error) throw new Error("Unable to retrieve completed upload.");
      return data as DocumentRecord | null;
    },
  };
}
