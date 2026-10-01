import { randomUUID } from "node:crypto";
import type { AuthorizedUser } from "../auth/types";
import { DriveServiceError } from "../google/drive-types";
import type { DriveFolderService } from "../google/drive-folders";
import type { FolderRepository, FolderFailureCategory } from "./folder-repository";
import { isSameOrigin } from "../http/origin";
import { protectedJson } from "../http/response";
import type { AuthorizationResult } from "../auth/types";
import { FolderValidationError, type ValidatedFolderRequest } from "./folder-validation";

export class FolderCreationError extends Error {
  constructor(readonly code: "FOLDER_EXISTS" | "FOLDER_IN_PROGRESS" | "DRIVE_ERROR" | "REGISTRY_ERROR", readonly status: number, message: string) { super(message); }
}

function exactFolder(metadata: { id: string; name: string; parents: string[]; mimeType: string; trashed: boolean } | null, expected: { id: string; name: string; parentId: string }) {
  return !!metadata && metadata.id === expected.id && metadata.name === expected.name && metadata.parents.length === 1 && metadata.parents[0] === expected.parentId && metadata.mimeType === "application/vnd.google-apps.folder" && metadata.trashed === false;
}

function category(error: unknown): FolderFailureCategory {
  if (error instanceof DriveServiceError && error.kind === "FORBIDDEN") return "DRIVE_PERMISSION";
  if (error instanceof DriveServiceError && error.kind === "NOT_FOUND") return "DRIVE_NOT_FOUND";
  if (error instanceof DriveServiceError && (error.kind === "TRANSIENT" || error.kind === "AMBIGUOUS")) return "DRIVE_UNAVAILABLE";
  return "DRIVE_UNKNOWN";
}

export async function createDocumentFolder(input: { actor: AuthorizedUser; idempotencyKey: string; logicalParentKey: string; driveParentId: string; name: string; normalizedName: string; repository: FolderRepository; drive: DriveFolderService }): Promise<{ name: string; destination: string; created: boolean }> {
  const token = randomUUID();
  let claim: Awaited<ReturnType<FolderRepository["claim"]>>;
  try { claim = await input.repository.claim({ actorId: input.actor.id, idempotencyKey: input.idempotencyKey, logicalParentKey: input.logicalParentKey, driveParentId: input.driveParentId, name: input.name, normalizedName: input.normalizedName, operationToken: token }); }
  catch { throw new FolderCreationError("REGISTRY_ERROR", 503, "Folder creation is temporarily unavailable."); }
  if (claim.outcome === "ACTIVE") return { name: input.name, destination: input.logicalParentKey, created: false };
  if (claim.outcome === "DUPLICATE_NAME") throw new FolderCreationError("FOLDER_EXISTS", 409, "A folder with this name already exists in the selected destination.");
  if (claim.outcome === "IN_PROGRESS" || !claim.folder_id || !claim.operation_token) throw new FolderCreationError("FOLDER_IN_PROGRESS", 409, "Folder creation is already in progress.");
  let driveId = claim.drive_folder_id;
  try {
    if (!driveId) {
      driveId = await input.drive.generateId();
      if (!await input.repository.persistDriveId(claim.folder_id, input.actor.id, claim.operation_token, driveId)) throw new FolderCreationError("FOLDER_IN_PROGRESS", 409, "Folder creation is already in progress.");
    }
    const expected = { id: driveId, name: input.name, parentId: input.driveParentId };
    const existing = await input.drive.get(driveId);
    if (!existing) {
      const created = await input.drive.create({ id: driveId, parentId: input.driveParentId, name: input.name });
      if (!exactFolder(created, expected)) throw new DriveServiceError("PROVIDER");
    } else if (!exactFolder(existing, expected)) throw new DriveServiceError("PROVIDER");
    if (!await input.repository.finalize(claim.folder_id, input.actor.id, claim.operation_token)) throw new FolderCreationError("FOLDER_IN_PROGRESS", 409, "Folder creation is already being finalized.");
    return { name: input.name, destination: input.logicalParentKey, created: true };
  } catch (error) {
    if (error instanceof FolderCreationError) throw error;
    try { await input.repository.fail(claim.folder_id, input.actor.id, claim.operation_token, category(error)); } catch {}
    throw new FolderCreationError("DRIVE_ERROR", error instanceof DriveServiceError && error.kind === "TRANSIENT" ? 503 : 502, "The folder could not be created. Please retry.");
  }
}

function responseError(code: string, message: string, status: number) { return protectedJson({ error: { code, message } }, status); }

export function createFolderHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  validate: (value: unknown) => ValidatedFolderRequest;
  resolveParent: (input: ValidatedFolderRequest) => { key: string; folderId: string };
  create: (input: { actor: AuthorizedUser; idempotencyKey: string; logicalParentKey: string; driveParentId: string; name: string; normalizedName: string }) => Promise<{ name: string; destination: string; created: boolean }>;
}) {
  return async function POST(request: Request) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return responseError(authorization.kind === "unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN", authorization.kind === "unauthenticated" ? "Sign in is required." : "Administrator access is required.", authorization.kind === "unauthenticated" ? 401 : 403);
    if (authorization.user.role !== "ADMIN") return responseError("FORBIDDEN", "Administrator access is required.", 403);
    if (!isSameOrigin(request)) return responseError("FORBIDDEN", "The request origin is not allowed.", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return responseError("VALIDATION_ERROR", "JSON content is required.", 400);
    let input: ValidatedFolderRequest;
    try { input = dependencies.validate(await request.json()); }
    catch (cause) { return responseError("VALIDATION_ERROR", cause instanceof FolderValidationError ? cause.message : "Folder request is invalid.", 400); }
    let parent;
    try { parent = dependencies.resolveParent(input); }
    catch { return responseError("DESTINATION_UNAVAILABLE", "The selected destination is not configured for folder creation.", 503); }
    try {
      const folder = await dependencies.create({ actor: authorization.user, idempotencyKey: input.idempotencyKey, logicalParentKey: parent.key, driveParentId: parent.folderId, name: input.name, normalizedName: input.normalizedName });
      return protectedJson({ folder }, folder.created ? 201 : 200);
    }
    catch (cause) {
      if (cause instanceof FolderCreationError) return responseError(cause.code, cause.message, cause.status);
      return responseError("REGISTRY_ERROR", "Folder creation is temporarily unavailable.", 503);
    }
  };
}
