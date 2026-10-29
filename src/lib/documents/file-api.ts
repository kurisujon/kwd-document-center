import { Readable } from "node:stream";
import { canReadDocument, hasMinimumRole } from "../auth/permissions";
import type { AuthorizationResult } from "../auth/types";
import { DriveServiceError, isDriveFileId, type DriveService } from "../google/drive-types";
import type { DocumentRecord } from "./types";
import { DocumentUploadError } from "./upload-service";
import { UploadValidationError, validateAdminUploadForm, validateFolderUploadForm } from "./upload-validation";
import type { UploadResult, ValidatedAdminUpload, ValidatedFolderUpload } from "./upload-types";
import type { AuthorizedUser } from "../auth/types";
import { isSameOrigin } from "../http/origin";
import { protectedJson, protectResponse } from "../http/response";
import { logOperationalFailure } from "../observability/log";

type FolderUploadDocumentDto = Pick<DocumentRecord, "document_id" | "document_type" | "document_number" | "document_date" | "subject" | "persons_involved" | "file_name" | "file_type" | "filing_year" | "filing_subcategory" | "status" | "created_at" | "updated_at">;

function toFolderUploadDocument(document: DocumentRecord): FolderUploadDocumentDto {
  return {
    document_id: document.document_id,
    document_type: document.document_type,
    document_number: document.document_number,
    document_date: document.document_date,
    subject: document.subject,
    persons_involved: document.persons_involved,
    file_name: document.file_name,
    file_type: document.file_type,
    filing_year: document.filing_year,
    filing_subcategory: document.filing_subcategory,
    status: document.status,
    created_at: document.created_at,
    updated_at: document.updated_at,
  };
}

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
  uploadFolderDocument?: (input: { upload: ValidatedFolderUpload; user: AuthorizedUser }) => Promise<UploadResult>;
}) {
  return async function POST(request: Request) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return authorizationError(authorization);
    if (!hasMinimumRole(authorization.user.role, "STAFF")) return jsonError("FORBIDDEN", "Staff access is required to upload documents.", 403);
    if (!isSameOrigin(request)) return jsonError("FORBIDDEN", "The upload request origin is not allowed.", 403);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("VALIDATION_ERROR", "The multipart upload request is invalid.", 400);
    }

    const hasTarget = formData.has("target_folder_id");
    const hasPath = formData.has("source_relative_path");
    if (hasTarget !== hasPath || formData.has("normalized_relative_path_key")) return jsonError("VALIDATION_ERROR", "Both folder upload fields are required.", 400);
    let result: UploadResult;
    try {
      if (hasTarget && hasPath) {
        if (!dependencies.uploadFolderDocument) return jsonError("VALIDATION_ERROR", "Folder upload is unavailable.", 400);
        result = await dependencies.uploadFolderDocument({ upload: await validateFolderUploadForm(formData), user: authorization.user });
      } else {
        result = await dependencies.uploadDocument({ upload: await validateAdminUploadForm(formData), user: authorization.user });
      }
    } catch (error) {
      if (error instanceof UploadValidationError) return jsonError("VALIDATION_ERROR", error.message, 400, error.field);
      if (error instanceof DocumentUploadError) {
        if (error.status >= 500) logOperationalFailure({ operation: "documents.upload", outcome: "failure", category: error.code, status: error.status });
        return jsonError(error.code, error.message, error.status);
      }
      logOperationalFailure({ operation: "documents.upload", outcome: "failure", category: "UNEXPECTED_UPLOAD_FAILURE", status: 500 });
      return jsonError("REGISTRY_ERROR", "The document upload could not be completed.", 500);
    }

    return protectedJson({ document: hasTarget ? toFolderUploadDocument(result.document) : result.document, reused: !result.created }, result.created ? 201 : 200);
  };
}

type FileApiDependencies = {
  getAuthorization: () => Promise<AuthorizationResult>;
  getDocument: (documentId: string) => Promise<DocumentRecord | null>;
  isDocumentId: (value: string) => boolean;
  drive: DriveService;
  recordAccessAudit?: (
    actorId: string,
    documentId: string,
    action: "DOCUMENT_OPEN" | "DOCUMENT_DOWNLOAD",
  ) => Promise<void>;
};

const INLINE_PREVIEW_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

export function isInlinePreviewableMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return INLINE_PREVIEW_MIME_TYPES.has(mimeType.split(";", 1)[0].trim().toLowerCase());
}

async function authorizedDocument(dependencies: FileApiDependencies, id: string) {
  const authorization = await dependencies.getAuthorization();
  if (authorization.kind !== "authorized") return { response: authorizationError(authorization) };
  if (!dependencies.isDocumentId(id)) return { response: jsonError("VALIDATION_ERROR", "Document ID is invalid.", 400, "id") };
  try {
    const document = await dependencies.getDocument(id);
    if (!document || !canReadDocument(authorization.user, document)) {
      return { response: jsonError("NOT_FOUND", "Document not found.", 404) };
    }
    if (!document.drive_file_id || !isDriveFileId(document.drive_file_id)) {
      return { response: jsonError("NOT_FOUND", "The document file is unavailable in Google Drive.", 404) };
    }
    return { user: authorization.user, document, driveFileId: document.drive_file_id };
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
    } catch (error) {
      return driveError(error, lookup.driveFileId);
    }
    if (dependencies.recordAccessAudit) {
      try {
        await dependencies.recordAccessAudit(lookup.user.id, lookup.document.document_id, "DOCUMENT_OPEN");
      } catch {
        logOperationalFailure({ operation: "documents.open.audit", outcome: "failure", category: "AUDIT_WRITE_FAILED", status: 500, resourceId: id });
        return jsonError("REGISTRY_ERROR", "Document access could not be recorded.", 500);
      }
    }
    return protectResponse(new Response(null, {
      status: 302,
      headers: { Location: `https://drive.google.com/file/d/${encodeURIComponent(lookup.driveFileId)}/view` },
    }));
  };
}

function contentDisposition(name: string, inline = false): string {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 150) || "document";
  const mode = inline ? "inline" : "attachment";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createDownloadDocumentHandler(dependencies: FileApiDependencies) {
  return async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const lookup = await authorizedDocument(dependencies, id);
    if ("response" in lookup) return lookup.response;
    const url = new URL(request.url);
    const requestedInline = url.searchParams.get("inline") === "1";

    let file: Awaited<ReturnType<DriveService["download"]>>;
    try {
      file = await dependencies.drive.download(lookup.driveFileId);
    } catch (error) {
      return driveError(error, lookup.driveFileId);
    }

    const serveInline = requestedInline && isInlinePreviewableMimeType(file.mimeType || lookup.document.file_type);

    if (!serveInline && dependencies.recordAccessAudit) {
      try {
        await dependencies.recordAccessAudit(lookup.user.id, lookup.document.document_id, "DOCUMENT_DOWNLOAD");
      } catch {
        file.stream.destroy();
        logOperationalFailure({ operation: "documents.download.audit", outcome: "failure", category: "AUDIT_WRITE_FAILED", status: 500, resourceId: id });
        return jsonError("REGISTRY_ERROR", "Document access could not be recorded.", 500);
      }
    }

    const headers = new Headers({
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(file.name, serveInline),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (file.size !== null && Number.isFinite(file.size)) headers.set("Content-Length", String(file.size));
    return protectResponse(new Response(Readable.toWeb(file.stream) as ReadableStream, { headers }));
  };
}
