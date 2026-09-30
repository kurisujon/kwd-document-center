import { randomUUID } from "node:crypto";
import type { AuthorizedUser } from "../auth/types";
import { DriveServiceError, type DriveDeletionService } from "../google/drive-types";
import { logOperationalFailure } from "../observability/log";
import type { DeletionRepository } from "./deletion-repository";

export class DocumentDeletionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "DELETE_IN_PROGRESS" | "DRIVE_ERROR" | "REGISTRY_ERROR", readonly status: number, message: string) { super(message); }
}

export async function deleteDocument(input: { documentId: string; actor: AuthorizedUser; repository: DeletionRepository; drive: DriveDeletionService }): Promise<{ deleted: true; reused: boolean }> {
  const operationToken = randomUUID();
  let claim;
  try {
    claim = await input.repository.claim(input.documentId, input.actor.id, operationToken);
  } catch {
    throw new DocumentDeletionError("REGISTRY_ERROR", 503, "Document deletion is temporarily unavailable.");
  }
  if (claim.outcome === "NOT_FOUND") throw new DocumentDeletionError("NOT_FOUND", 404, "Document not found.");
  if (claim.outcome === "ALREADY_DELETED") return { deleted: true, reused: true };
  if (claim.outcome === "IN_PROGRESS" || !claim.operation_token) throw new DocumentDeletionError("DELETE_IN_PROGRESS", 409, "Document deletion is already in progress.");

  let driveTrashed = false;
  try {
    if (claim.drive_file_id) {
      const result = await input.drive.trash(claim.drive_file_id);
      driveTrashed = result.disposition === "TRASHED";
    }
  } catch (error) {
    const category = error instanceof DriveServiceError && error.kind === "FORBIDDEN" ? "DRIVE_PERMISSION"
      : error instanceof DriveServiceError && error.kind === "TRANSIENT" ? "DRIVE_UNAVAILABLE" : "DRIVE_UNKNOWN";
    try { await input.repository.fail(input.documentId, input.actor.id, claim.operation_token, category); } catch {}
    logOperationalFailure({ operation: "documents.delete.drive", outcome: "failure", category, status: category === "DRIVE_UNAVAILABLE" ? 503 : 502, resourceId: input.documentId });
    throw new DocumentDeletionError("DRIVE_ERROR", category === "DRIVE_UNAVAILABLE" ? 503 : 502, "The document could not be moved to Google Drive Trash. Please retry.");
  }

  try {
    if (!await input.repository.finalize(input.documentId, input.actor.id, claim.operation_token, driveTrashed)) {
      throw new DocumentDeletionError("DELETE_IN_PROGRESS", 409, "Document deletion is already being finalized.");
    }
  } catch (error) {
    if (error instanceof DocumentDeletionError) throw error;
    logOperationalFailure({ operation: "documents.delete.finalize", outcome: "failure", category: "REGISTRY_FINALIZATION", status: 503, resourceId: input.documentId });
    throw new DocumentDeletionError("REGISTRY_ERROR", 503, "The file was moved to Google Drive Trash, but registry deletion is pending. Please retry.");
  }
  return { deleted: true, reused: false };
}
