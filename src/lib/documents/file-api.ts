import { Readable } from "node:stream";
import { hasMinimumRole } from "../auth/permissions";
import type { AuthorizationResult } from "../auth/types";
import { DriveServiceError, isDriveFileId, type DriveService } from "../google/drive-types";
import type { DocumentRecord } from "./types";
import { DocumentUploadError } from "./upload-service";
import { UploadValidationError, validateAdminUploadForm } from "./upload-validation";
import type { UploadResult, ValidatedAdminUpload } from "./upload-types";
import type { AuthorizedUser } from "../auth/types";
import { isSameOrigin } from "../http/origin";
import { protectedJson, protectResponse } from "../http/response";
import { logOperationalFailure } from "../observability/log";

function jsonError(code: string, message: string, status: number, field?: string) {
  return protectedJson({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

function authorizationError(authorization: Exclude<AuthorizationResult, { kind: "authorized" }>) {
  if (authorization.kind === "unauthenticated") return jsonError("UNAUTHORIZED", "Sign in is required.", 401);
  return jsonError("FORBIDDEN", "You are not authorized to perform this operation.", 403);
}

function driveError(error: unknown, resourceId?: string) {
  if (error instanceof DriveServiceError && (error.kind === "NOT_FOUND" || error.kind === "INVALID_ID")) {
    logOperationalFailure({ operation: "documents.drive", outcome: "failure", category: "DRIVE_FILE_NOT_FOUND", status: 404, ...(resourceId ? { resourceId } : {}) });
    return jsonError("NOT_FOUND", "The document file is unavailable in Google Drive.", 404);
  }
  logOperationalFailure({ operation: "documents.drive", outcome: "failure", category: "DRIVE_OPERATION_FAILED", status: 503, ...(resourceId ? { resourceId } : {}) });
  return jsonError("DRIVE_ERROR", "The document file is temporarily unavailable.", 503);
}

export function createUploadDocumentHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  uploadDocument: (input: { upload: ValidatedAdminUpload; user: AuthorizedUser }) => Promise<UploadResult>;
}) {
  return async function POST(request: Request) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return authorizationError(authorization);
    if (!hasMinimumRole(authorization.user.role, "STAFF")) return jsonError("FORBIDDEN", "Staff access is required to upload documents.", 403);
    if (!isSameOrigin(request)) return jsonError("FORBIDDEN", "The upload request origin is not allowed.", 403);

    let upload;
    try {
      upload = await validateAdminUploadForm(await request.formData());
    } catch (error) {
      if (error instanceof UploadValidationError) return jsonError("VALIDATION_ERROR", error.message, 400, error.field);
      return jsonError("VALIDATION_ERROR", "The multipart upload request is invalid.", 400);
    }

    try {
      const result = await dependencies.uploadDocument({ upload, user: authorization.user });
      return protectedJson({ document: result.document, reused: !result.created }, result.created ? 201 : 200);
    } catch (error) {
      if (error instanceof DocumentUploadError) {
        if (error.status >= 500) logOperationalFailure({ operation: "documents.upload", outcome: "failure", category: error.code, status: error.status });
        return jsonError(error.code, error.message, error.status);
      }
      logOperationalFailure({ operation: "documents.upload", outcome: "failure", category: "UNEXPECTED_UPLOAD_FAILURE", status: 500 });
      return jsonError("REGISTRY_ERROR", "The document upload could not be completed.", 500);
    }
  };
}

type FileApiDependencies = {
  getAuthorization: () => Promise<AuthorizationResult>;
  getDocument: (documentId: string) => Promise<DocumentRecord | null>;
  isDocumentId: (value: string) => boolean;
  drive: DriveService;
};

async function authorizedDocument(dependencies: FileApiDependencies, id: string) {
  const authorization = await dependencies.getAuthorization();
  if (authorization.kind !== "authorized") return { response: authorizationError(authorization) };
  if (!dependencies.isDocumentId(id)) return { response: jsonError("VALIDATION_ERROR", "Document ID is invalid.", 400, "id") };
  try {
    const document = await dependencies.getDocument(id);
    if (!document) return { response: jsonError("NOT_FOUND", "Document not found.", 404) };
    if (document.deletion_state && document.deletion_state !== "ACTIVE") return { response: jsonError("NOT_FOUND", "Document not found.", 404) };
    if (!document.drive_file_id || !isDriveFileId(document.drive_file_id)) {
      return { response: jsonError("NOT_FOUND", "The document file is unavailable in Google Drive.", 404) };
    }
    return { document, driveFileId: document.drive_file_id };
  } catch {
    logOperationalFailure({ operation: "documents.file_lookup", outcome: "failure", category: "REGISTRY_READ_FAILED", status: 500, resourceId: id });
    return { response: jsonError("REGISTRY_ERROR", "Document details are temporarily unavailable.", 500) };
  }
}

export function createOpenDocumentHandler(dependencies: FileApiDependencies) {
  return async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const lookup = await authorizedDocument(dependencies, id);
    if ("response" in lookup) return lookup.response;
    try {
      await dependencies.drive.getMetadata(lookup.driveFileId);
      return protectResponse(new Response(null, {
        status: 302,
        headers: { Location: `https://drive.google.com/file/d/${encodeURIComponent(lookup.driveFileId)}/view` },
      }));
    } catch (error) {
      return driveError(error, lookup.driveFileId);
    }
  };
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 150) || "document";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createDownloadDocumentHandler(dependencies: FileApiDependencies) {
  return async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const lookup = await authorizedDocument(dependencies, id);
    if ("response" in lookup) return lookup.response;
    try {
      const file = await dependencies.drive.download(lookup.driveFileId);
      const headers = new Headers({
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition(file.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (file.size !== null && Number.isFinite(file.size)) headers.set("Content-Length", String(file.size));
      return protectResponse(new Response(Readable.toWeb(file.stream) as ReadableStream, { headers }));
    } catch (error) {
      return driveError(error, lookup.driveFileId);
    }
  };
}
