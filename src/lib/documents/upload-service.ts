import type { AuthorizedUser } from "../auth/types";
import { DriveConfigurationError, getAdminDriveFolderId } from "./drive-config";
import type { DriveService } from "../google/drive-types";
import { DriveServiceError } from "../google/drive-types";
import { createHash } from "node:crypto";
import type { FolderUploadAttemptRepository, UploadAttemptRepository } from "./upload-repository";
import { resolveFolderUploadDestinationContext, type FolderUploadDestinationContext } from "./upload-destination";
import type { HierarchyFolderRecord } from "./hierarchy-repository";
import type { UploadAttempt, UploadMetadataSnapshot, UploadResult, ValidatedAdminUpload, ValidatedFolderUpload } from "./upload-types";
import { logOperationalFailure } from "../observability/log";

export type UploadErrorCode = "VALIDATION_ERROR" | "DRIVE_ERROR" | "REGISTRY_ERROR" | "UPLOAD_IN_PROGRESS" | "DUPLICATE_DOCUMENT";

export class DocumentUploadError extends Error {
  readonly code: UploadErrorCode;
  readonly status: number;

  constructor(code: UploadErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function snapshotOf(upload: ValidatedAdminUpload): UploadMetadataSnapshot {
  return {
    ...upload.metadata,
    file_name: upload.file.name,
    file_type: upload.file.mimeType,
    file_size: upload.file.size,
    custom_metadata: upload.metadata.custom_metadata,
    file_sha256: upload.fileSha256,
    duplicate_override: upload.duplicateOverride,
    duplicate_override_reason: upload.duplicateOverrideReason,
  };
}

function folderSnapshotOf(upload: ValidatedFolderUpload, destination: FolderUploadDestinationContext): UploadMetadataSnapshot {
  return {
    document_type: destination.category as UploadMetadataSnapshot["document_type"],
    document_number: upload.metadata.document_number,
    document_date: upload.metadata.document_date,
    subject: upload.metadata.subject,
    persons_involved: upload.metadata.persons_involved,
    filing_year: destination.filingYear,
    filing_subcategory: destination.subcategory ?? "",
    file_name: upload.file.name,
    file_type: upload.file.mimeType,
    file_size: upload.file.size,
  };
}

function folderHash(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function sameSnapshot(left: UploadMetadataSnapshot, right: UploadMetadataSnapshot): boolean {
  return left.document_type === right.document_type
    && left.document_number === right.document_number
    && left.document_date === right.document_date
    && left.subject === right.subject
    && left.persons_involved === right.persons_involved
    && left.filing_year === right.filing_year
    && left.filing_subcategory === right.filing_subcategory
    && left.file_name === right.file_name
    && left.file_type === right.file_type
    && left.file_size === right.file_size
    && JSON.stringify(left.custom_metadata ?? {}) === JSON.stringify(right.custom_metadata ?? {});
}

async function loadAfterUniqueConflict(repository: UploadAttemptRepository, key: string): Promise<UploadAttempt> {
  const attempt = await repository.findByIdempotencyKey(key);
  if (!attempt) throw new DocumentUploadError("REGISTRY_ERROR", "The upload could not be started. Please try again.", 500);
  return attempt;
}

async function finalize(repository: UploadAttemptRepository, attempt: UploadAttempt, user: AuthorizedUser, created: boolean): Promise<UploadResult> {
  if (!attempt.drive_file_id) throw new DocumentUploadError("REGISTRY_ERROR", "The upload state is incomplete. Please contact an administrator.", 500);
  try {
    return { document: await repository.finalize(attempt, user.email), created };
  } catch {
    logOperationalFailure({ operation: "documents.upload.finalize", outcome: "failure", category: "REGISTRY_FINALIZATION_FAILED", status: 500, resourceId: attempt.id });
    throw new DocumentUploadError("REGISTRY_ERROR", "The file is safely stored, but its registry entry is pending. Retry this upload to finish registration.", 500);
  }
}

export async function uploadAdminDocument(input: {
  upload: ValidatedAdminUpload;
  user: AuthorizedUser;
  repository: UploadAttemptRepository;
  drive: DriveService;
}): Promise<UploadResult> {
  const { upload, user, repository, drive } = input;
  const snapshot = snapshotOf(upload);
  let attempt = await repository.findByIdempotencyKey(upload.idempotencyKey);

  if (attempt) {
    if (attempt.created_by !== user.id || !sameSnapshot(attempt.metadata_snapshot, snapshot)) {
      throw new DocumentUploadError("VALIDATION_ERROR", "This idempotency key belongs to a different upload.", 409);
    }
    if (attempt.status === "COMPLETE" && attempt.document_id) {
      const document = await repository.getDocument(attempt.document_id);
      if (!document) throw new DocumentUploadError("REGISTRY_ERROR", "The completed document could not be loaded.", 500);
      return { document, created: false };
    }
    if (attempt.status === "PENDING_REGISTRY") return finalize(repository, attempt, user, false);
  }

  if (!attempt) {
    if (!upload.duplicateOverride && repository.checkDuplicate && upload.fileSha256) {
      const duplicate = await repository.checkDuplicate(
        user.id,
        upload.metadata.document_type,
        upload.metadata.document_number,
        upload.fileSha256,
      );
      if (duplicate) {
        const isConfidential = duplicate.isConfidential || duplicate.duplicateKind.startsWith("CONFIDENTIAL");
        const kind = duplicate.duplicateKind.includes("HASH") ? "HASH" : "NUMBER";
        const message = kind === "HASH"
          ? (isConfidential
              ? "A matching file is already registered in the Document Center. Provide an override reason to proceed."
              : `An identical file is already registered as ${duplicate.existingDocumentNumber || "a document"}${duplicate.existingSubject ? ` ("${duplicate.existingSubject}")` : ""}. Provide an override reason to proceed.`)
          : (isConfidential
              ? `A document with number "${upload.metadata.document_number}" is already registered. Provide an override reason to proceed.`
              : `A document with number "${duplicate.existingDocumentNumber || upload.metadata.document_number}" is already registered ("${duplicate.existingSubject || ""}"). Provide an override reason to proceed.`);
        throw new DocumentUploadError("DUPLICATE_DOCUMENT", message, 409);
      }
    }
  }

  let folderId: string;
  try {
    folderId = getAdminDriveFolderId(upload.metadata.document_type, upload.metadata.filing_year, upload.metadata.filing_subcategory);
  } catch (error) {
    if (error instanceof DriveConfigurationError) {
      logOperationalFailure({ operation: "documents.upload.configuration", outcome: "failure", category: "DRIVE_DESTINATION_CONFIGURATION_FAILED", status: 503 });
      throw new DocumentUploadError("DRIVE_ERROR", "The destination for this Admin category is not configured.", 503);
    }
    throw error;
  }

  if (!attempt) {
    try {
      attempt = await repository.create(upload.idempotencyKey, user.id, snapshot);
    } catch (error) {
      if ((error as { databaseCode?: string }).databaseCode === "23505") {
        attempt = await loadAfterUniqueConflict(repository, upload.idempotencyKey);
        if (attempt.created_by !== user.id || !sameSnapshot(attempt.metadata_snapshot, snapshot)) {
          throw new DocumentUploadError("VALIDATION_ERROR", "This idempotency key belongs to a different upload.", 409);
        }
        if (attempt.status === "COMPLETE" && attempt.document_id) {
          const document = await repository.getDocument(attempt.document_id);
          if (!document) throw new DocumentUploadError("REGISTRY_ERROR", "The completed document could not be loaded.", 500);
          return { document, created: false };
        }
        return uploadAdminDocument(input);
      }
      throw new DocumentUploadError("REGISTRY_ERROR", "The upload could not be started. Please try again.", 500);
    }
  }

  // Track the current operation token for this execution. All later state
  // transitions (markPendingRegistry, markFailed) require this exact token.
  // A newer retry will generate a different token, invalidating this one.
  let operationToken: string | null = null;

  if (attempt.status === "PENDING_UPLOAD") {
    const claim = await repository.claimDriveIdReservation(attempt.id);
    if (!claim.claimed) {
      throw new DocumentUploadError("UPLOAD_IN_PROGRESS", "This upload is already being processed. Please retry shortly.", 409);
    }
    operationToken = claim.operationToken;

    let driveFileId: string;
    try {
      driveFileId = await drive.generateFileId();
    } catch {
      await repository.clearDriveIdReservation(attempt.id, operationToken!);
      logOperationalFailure({ operation: "documents.upload.reserve", outcome: "failure", category: "DRIVE_ID_RESERVATION_FAILED", status: 503, resourceId: attempt.id });
      throw new DocumentUploadError("DRIVE_ERROR", "Google Drive could not reserve an upload ID. Please retry.", 503);
    }

    let persisted = false;
    try {
      persisted = await repository.persistDriveFileId(attempt.id, driveFileId, operationToken!);
    } catch {
      // If a transient database failure occurred while ownership token is still valid,
      // retry persistence once under the same operation token.
      try {
        persisted = await repository.persistDriveFileId(attempt.id, driveFileId, operationToken!);
      } catch {
        logOperationalFailure({ operation: "documents.upload.persistence", outcome: "failure", category: "DRIVE_ID_STATE_SAVE_FAILED", status: 500, resourceId: attempt.id });
        throw new DocumentUploadError("REGISTRY_ERROR", "The file upload state could not be saved. Please contact an administrator before retrying.", 500);
      }
    }
    if (!persisted) return uploadAdminDocument(input);

    attempt = { ...attempt, status: "UPLOADING", drive_file_id: driveFileId, operation_token: operationToken, reservation_expires_at: null, safe_error_code: null };
  }

  if (attempt.status === "FAILED") {
    if (!attempt.drive_file_id) {
      throw new DocumentUploadError("REGISTRY_ERROR", "The upload state is incomplete. Please contact an administrator.", 500);
    }
    const resume = await repository.resumeUpload(attempt.id);
    if (!resume.resumed) return uploadAdminDocument(input);
    operationToken = resume.operationToken;
    attempt = { ...attempt, status: "UPLOADING", operation_token: operationToken, safe_error_code: null };
  }

  if (attempt.status !== "UPLOADING" || !attempt.drive_file_id || !operationToken) {
    throw new DocumentUploadError("UPLOAD_IN_PROGRESS", "This upload is already being processed. Please retry shortly.", 409);
  }

  try {
    const driveFile = await drive.upload({
      fileId: attempt.drive_file_id,
      folderId,
      name: upload.file.name,
      mimeType: upload.file.mimeType,
      bytes: upload.file.bytes,
      uploadAttemptId: attempt.id,
    });
    if (!await repository.markPendingRegistry(attempt.id, driveFile.id, operationToken)) return uploadAdminDocument(input);
    attempt = { ...attempt, status: "PENDING_REGISTRY", drive_file_id: driveFile.id };
  } catch (error) {
    if (error instanceof DriveServiceError) {
      if (error.kind !== "AMBIGUOUS") {
        try {
          const failure = await repository.markFailed(attempt.id, attempt.drive_file_id!, operationToken, "DRIVE_ERROR");
          if (!failure.changed && failure.attempt?.status === "PENDING_REGISTRY") return finalize(repository, failure.attempt, user, false);
          if (!failure.changed && failure.attempt?.status === "COMPLETE" && failure.attempt.document_id) {
            const document = await repository.getDocument(failure.attempt.document_id);
            if (!document) throw new DocumentUploadError("REGISTRY_ERROR", "The completed document could not be loaded.", 500);
            return { document, created: false };
          }
        } catch (failureError) {
          if (failureError instanceof DocumentUploadError) throw failureError;
        }
      }
      throw new DocumentUploadError("DRIVE_ERROR", "Google Drive upload recovery is pending. Retry this submission with the same idempotency key.", error.kind === "FORBIDDEN" ? 502 : 503);
    }
    logOperationalFailure({ operation: "documents.upload.state", outcome: "failure", category: "UPLOAD_STATE_SAVE_FAILED", status: 500, resourceId: attempt.id });
    throw new DocumentUploadError("REGISTRY_ERROR", "The file upload state could not be saved. Please contact an administrator before retrying.", 500);
  }

  return finalize(repository, attempt, user, true);
}

async function finalizeFolder(repository: FolderUploadAttemptRepository, attempt: UploadAttempt, user: AuthorizedUser, created: boolean): Promise<UploadResult> {
  if (!attempt.drive_file_id) throw new DocumentUploadError("REGISTRY_ERROR", "The upload state is incomplete. Please contact an administrator.", 500);
  try {
    return { document: await repository.finalizeFolderUploadAttempt({ attemptId: attempt.id, actorId: user.id, expectedDriveFileId: attempt.drive_file_id }), created };
  } catch {
    logOperationalFailure({ operation: "documents.folder_upload.finalize", outcome: "failure", category: "REGISTRY_FINALIZATION_FAILED", status: 500, resourceId: attempt.id });
    throw new DocumentUploadError("REGISTRY_ERROR", "The file is safely stored, but its registry entry is pending. Retry this upload to finish registration.", 500);
  }
}

export async function uploadFolderDocument(input: {
  upload: ValidatedFolderUpload;
  user: AuthorizedUser;
  attempts: UploadAttemptRepository;
  folderAttempts: FolderUploadAttemptRepository;
  getDestination: (folderId: string) => Promise<HierarchyFolderRecord | null>;
  drive: DriveService;
}): Promise<UploadResult> {
  const record = await input.getDestination(input.upload.targetFolderId);
  if (!record) throw new DocumentUploadError("VALIDATION_ERROR", "The upload destination is unavailable.", 400);
  let destination: FolderUploadDestinationContext;
  try { destination = resolveFolderUploadDestinationContext(record); }
  catch { throw new DocumentUploadError("VALIDATION_ERROR", "The upload destination is unavailable.", 400); }
  const snapshot = folderSnapshotOf(input.upload, destination);
  const claim = await input.folderAttempts.claimFolderUploadAttempt({
    actorId: input.user.id,
    idempotencyKey: input.upload.idempotencyKey,
    destinationFolderId: destination.folderId,
    sourceRelativePath: input.upload.sourceRelativePath,
    normalizedRelativePathKey: input.upload.normalizedRelativePathKey,
    contentSha256: folderHash(input.upload.file.bytes),
    metadataSnapshot: snapshot,
  });
  if (claim.outcome === "DUPLICATE_PATH" || claim.outcome === "IDEMPOTENCY_MISMATCH") throw new DocumentUploadError("VALIDATION_ERROR", "This upload conflicts with an existing folder upload.", 409);
  if (claim.outcome === "INVALID_DESTINATION" || claim.outcome === "INVALID_REQUEST") throw new DocumentUploadError("VALIDATION_ERROR", "The folder upload request is invalid.", 400);
  if (claim.outcome === "NOT_AUTHORIZED") throw new DocumentUploadError("VALIDATION_ERROR", "You are not authorized to upload to this destination.", 403);
  if (claim.outcome === "COMPLETE") {
    if (!claim.documentId) throw new DocumentUploadError("REGISTRY_ERROR", "The completed document could not be loaded.", 500);
    const document = await input.attempts.getDocument(claim.documentId);
    if (!document) throw new DocumentUploadError("REGISTRY_ERROR", "The completed document could not be loaded.", 500);
    return { document, created: false };
  }
  let attempt = await input.attempts.findByIdempotencyKey(input.upload.idempotencyKey);
  if (!attempt) throw new DocumentUploadError("REGISTRY_ERROR", "The upload could not be started. Please try again.", 500);
  if (attempt.status === "PENDING_REGISTRY") return finalizeFolder(input.folderAttempts, attempt, input.user, false);

  let operationToken: string | null = null;
  if (attempt.status === "PENDING_UPLOAD") {
    const reservation = await input.attempts.claimDriveIdReservation(attempt.id);
    if (!reservation.claimed) throw new DocumentUploadError("UPLOAD_IN_PROGRESS", "This upload is already being processed. Please retry shortly.", 409);
    operationToken = reservation.operationToken;
    let driveFileId: string;
    try { driveFileId = await input.drive.generateFileId(); }
    catch {
      await input.attempts.clearDriveIdReservation(attempt.id, operationToken!);
      throw new DocumentUploadError("DRIVE_ERROR", "Google Drive could not reserve an upload ID. Please retry.", 503);
    }
    let persisted = false;
    try { persisted = await input.attempts.persistDriveFileId(attempt.id, driveFileId, operationToken!); }
    catch {
      try { persisted = await input.attempts.persistDriveFileId(attempt.id, driveFileId, operationToken!); }
      catch { throw new DocumentUploadError("REGISTRY_ERROR", "The file upload state could not be saved. Please contact an administrator before retrying.", 500); }
    }
    if (!persisted) return uploadFolderDocument(input);
    attempt = { ...attempt, status: "UPLOADING", drive_file_id: driveFileId, operation_token: operationToken, reservation_expires_at: null, safe_error_code: null };
  }
  if (attempt.status === "FAILED") {
    if (!attempt.drive_file_id) throw new DocumentUploadError("REGISTRY_ERROR", "The upload state is incomplete. Please contact an administrator.", 500);
    const resumed = await input.attempts.resumeUpload(attempt.id);
    if (!resumed.resumed) return uploadFolderDocument(input);
    operationToken = resumed.operationToken;
    attempt = { ...attempt, status: "UPLOADING", operation_token: operationToken, safe_error_code: null };
  }
  if (attempt.status !== "UPLOADING" || !attempt.drive_file_id || !operationToken) throw new DocumentUploadError("UPLOAD_IN_PROGRESS", "This upload is already being processed. Please retry shortly.", 409);
  try {
    const driveFile = await input.drive.upload({ fileId: attempt.drive_file_id, folderId: destination.driveFolderId, name: input.upload.file.name, mimeType: input.upload.file.mimeType, bytes: input.upload.file.bytes, uploadAttemptId: attempt.id });
    if (!await input.attempts.markPendingRegistry(attempt.id, driveFile.id, operationToken)) return uploadFolderDocument(input);
    attempt = { ...attempt, status: "PENDING_REGISTRY", drive_file_id: driveFile.id };
  } catch (error) {
    if (error instanceof DriveServiceError) {
      if (error.kind !== "AMBIGUOUS") {
        const failure = await input.attempts.markFailed(attempt.id, attempt.drive_file_id!, operationToken, "DRIVE_ERROR");
        if (!failure.changed && failure.attempt?.status === "PENDING_REGISTRY") return finalizeFolder(input.folderAttempts, failure.attempt, input.user, false);
        if (!failure.changed && failure.attempt?.status === "COMPLETE" && failure.attempt.document_id) {
          const document = await input.attempts.getDocument(failure.attempt.document_id);
          if (!document) throw new DocumentUploadError("REGISTRY_ERROR", "The completed document could not be loaded.", 500);
          return { document, created: false };
        }
      }
      throw new DocumentUploadError("DRIVE_ERROR", "Google Drive upload recovery is pending. Retry this submission with the same idempotency key.", error.kind === "FORBIDDEN" ? 502 : 503);
    }
    throw new DocumentUploadError("REGISTRY_ERROR", "The file upload state could not be saved. Please contact an administrator before retrying.", 500);
  }
  return finalizeFolder(input.folderAttempts, attempt, input.user, true);
}
