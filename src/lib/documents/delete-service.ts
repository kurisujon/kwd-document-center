import { randomUUID } from "node:crypto";
import type { AuthorizedUser } from "../auth/types";
import { DriveServiceError, type DriveDeletionService } from "../google/drive-types";
import { logOperationalFailure } from "../observability/log";
import type { DeletionRepository, TrashedDocumentRecord } from "./deletion-repository";

export class DocumentDeletionError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "DELETE_IN_PROGRESS"
      | "ALREADY_PURGED"
      | "NOT_DELETED"
      | "VALIDATION_ERROR"
      | "DRIVE_ERROR"
      | "REGISTRY_ERROR",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function deleteDocument(input: {
  documentId: string;
  actor: AuthorizedUser;
  repository: Pick<DeletionRepository, "softDelete">;
}): Promise<{ deleted: true; reused: boolean }> {
  let result;
  try {
    result = await input.repository.softDelete(input.documentId, input.actor.id);
  } catch {
    throw new DocumentDeletionError(
      "REGISTRY_ERROR",
      503,
      "Document deletion is temporarily unavailable.",
    );
  }
  if (result.outcome === "NOT_FOUND") {
    throw new DocumentDeletionError("NOT_FOUND", 404, "Document not found.");
  }
  if (result.outcome === "ALREADY_DELETED") {
    return { deleted: true, reused: true };
  }
  if (result.outcome === "IN_PROGRESS") {
    throw new DocumentDeletionError(
      "DELETE_IN_PROGRESS",
      409,
      "A lifecycle operation is already in progress for this document.",
    );
  }
  return { deleted: true, reused: false };
}

export async function listTrashedDocuments(input: {
  actor: AuthorizedUser;
  repository: Pick<DeletionRepository, "listTrashed">;
}): Promise<TrashedDocumentRecord[]> {
  try {
    return await input.repository.listTrashed(input.actor.id);
  } catch {
    throw new DocumentDeletionError(
      "REGISTRY_ERROR",
      503,
      "Trash records are temporarily unavailable.",
    );
  }
}

export async function restoreDocument(input: {
  documentId: string;
  actor: AuthorizedUser;
  repository: Pick<DeletionRepository, "prepareRestore" | "completeRestore">;
  drive?: DriveDeletionService;
}): Promise<{ restored: true; reused: boolean }> {
  let prep;
  try {
    prep = await input.repository.prepareRestore(input.documentId, input.actor.id);
  } catch {
    throw new DocumentDeletionError(
      "REGISTRY_ERROR",
      503,
      "Document restore is temporarily unavailable.",
    );
  }

  if (prep.outcome === "NOT_FOUND") {
    throw new DocumentDeletionError("NOT_FOUND", 404, "Document not found.");
  }
  if (prep.outcome === "ALREADY_PURGED") {
    throw new DocumentDeletionError(
      "ALREADY_PURGED",
      409,
      "Purged documents cannot be restored.",
    );
  }
  if (prep.outcome === "ALREADY_ACTIVE") {
    return { restored: true, reused: true };
  }
  if (prep.outcome === "IN_PROGRESS") {
    throw new DocumentDeletionError(
      "DELETE_IN_PROGRESS",
      409,
      "A lifecycle operation is already in progress for this document.",
    );
  }
  if (prep.outcome === "RESTORED") {
    return { restored: true, reused: false };
  }

  // Legacy soft-deleted rows that had drive_trashed_at set before ADR-006 must be untrashed in Drive first.
  if (prep.outcome === "NEEDS_DRIVE_UNTRASH" && prep.drive_file_id) {
    if (!input.drive?.untrash) {
      throw new DocumentDeletionError(
        "DRIVE_ERROR",
        503,
        "Google Drive restore is temporarily unavailable.",
      );
    }
    try {
      await input.drive.untrash(prep.drive_file_id);
    } catch (error) {
      const category =
        error instanceof DriveServiceError && error.kind === "FORBIDDEN"
          ? "DRIVE_PERMISSION"
          : error instanceof DriveServiceError && error.kind === "TRANSIENT"
            ? "DRIVE_UNAVAILABLE"
            : "DRIVE_UNKNOWN";
      logOperationalFailure({
        operation: "documents.restore.drive",
        outcome: "failure",
        category,
        status: category === "DRIVE_UNAVAILABLE" ? 503 : 502,
        resourceId: input.documentId,
      });
      throw new DocumentDeletionError(
        "DRIVE_ERROR",
        category === "DRIVE_UNAVAILABLE" ? 503 : 502,
        "The document could not be restored from Google Drive Trash. Please retry.",
      );
    }

    try {
      const completed = await input.repository.completeRestore(input.documentId, input.actor.id);
      if (!completed) {
        throw new DocumentDeletionError(
          "DELETE_IN_PROGRESS",
          409,
          "Document restore could not be finalized.",
        );
      }
    } catch (error) {
      if (error instanceof DocumentDeletionError) throw error;
      logOperationalFailure({
        operation: "documents.restore.finalize",
        outcome: "failure",
        category: "REGISTRY_FINALIZATION",
        status: 503,
        resourceId: input.documentId,
      });
      throw new DocumentDeletionError(
        "REGISTRY_ERROR",
        503,
        "Document restore is pending in the registry. Please retry.",
      );
    }
  }

  return { restored: true, reused: false };
}

export async function purgeDocument(input: {
  documentId: string;
  actor: AuthorizedUser;
  reason: string;
  repository: Pick<DeletionRepository, "claimPurge" | "finalizePurge" | "fail">;
  drive: DriveDeletionService;
}): Promise<{ purged: true; reused: boolean }> {
  const normalizedReason = input.reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) {
    throw new DocumentDeletionError(
      "VALIDATION_ERROR",
      400,
      "A purge reason between 1 and 500 characters is required.",
    );
  }

  const operationToken = randomUUID();
  let claim;
  try {
    claim = await input.repository.claimPurge(input.documentId, input.actor.id, operationToken);
  } catch {
    throw new DocumentDeletionError(
      "REGISTRY_ERROR",
      503,
      "Document purge is temporarily unavailable.",
    );
  }

  if (claim.outcome === "NOT_FOUND") {
    throw new DocumentDeletionError("NOT_FOUND", 404, "Document not found.");
  }
  if (claim.outcome === "ALREADY_PURGED") {
    return { purged: true, reused: true };
  }
  if (claim.outcome === "NOT_DELETED") {
    throw new DocumentDeletionError(
      "NOT_DELETED",
      409,
      "The document must be moved to Trash before it can be purged.",
    );
  }
  if (claim.outcome === "IN_PROGRESS" || !claim.operation_token) {
    throw new DocumentDeletionError(
      "DELETE_IN_PROGRESS",
      409,
      "Document purge is already in progress.",
    );
  }

  let driveTrashed = false;
  try {
    if (claim.drive_file_id) {
      const result = await input.drive.trash(claim.drive_file_id);
      driveTrashed = result.disposition === "TRASHED";
    }
  } catch (error) {
    const category =
      error instanceof DriveServiceError && error.kind === "FORBIDDEN"
        ? "DRIVE_PERMISSION"
        : error instanceof DriveServiceError && error.kind === "TRANSIENT"
          ? "DRIVE_UNAVAILABLE"
          : "DRIVE_UNKNOWN";
    try {
      await input.repository.fail(
        input.documentId,
        input.actor.id,
        claim.operation_token,
        category,
      );
    } catch {}
    logOperationalFailure({
      operation: "documents.purge.drive",
      outcome: "failure",
      category,
      status: category === "DRIVE_UNAVAILABLE" ? 503 : 502,
      resourceId: input.documentId,
    });
    throw new DocumentDeletionError(
      "DRIVE_ERROR",
      category === "DRIVE_UNAVAILABLE" ? 503 : 502,
      "The document could not be moved to Google Drive Trash. Please retry.",
    );
  }

  try {
    const finalized = await input.repository.finalizePurge(
      input.documentId,
      input.actor.id,
      claim.operation_token,
      driveTrashed,
      normalizedReason,
    );
    if (!finalized) {
      throw new DocumentDeletionError(
        "DELETE_IN_PROGRESS",
        409,
        "Document purge is already being finalized.",
      );
    }
  } catch (error) {
    if (error instanceof DocumentDeletionError) throw error;
    logOperationalFailure({
      operation: "documents.purge.finalize",
      outcome: "failure",
      category: "REGISTRY_FINALIZATION",
      status: 503,
      resourceId: input.documentId,
    });
    throw new DocumentDeletionError(
      "REGISTRY_ERROR",
      503,
      "The file was moved to Google Drive Trash, but registry purge is pending. Please retry.",
    );
  }

  return { purged: true, reused: false };
}
