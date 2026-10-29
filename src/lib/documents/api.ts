import { canReadDocument } from "../auth/permissions";
import type { AuthorizationResult, AuthorizedUser } from "../auth/types";
import type { NextRequest } from "next/server";
import type { QueryValidationResult } from "./query";
import type { DocumentListQuery, DocumentRecord, PaginatedDocuments } from "./types";
import { protectedJson } from "../http/response";
import { logOperationalFailure } from "../observability/log";

type AuthorizationFailure = Exclude<AuthorizationResult["kind"], "authorized">;

function json(body: unknown, status = 200) {
  return protectedJson(body, status);
}

function authorizationError(kind: AuthorizationFailure) {
  if (kind === "unauthenticated") {
    return json({ error: { code: "UNAUTHORIZED", message: "Sign in is required to access documents." } }, 401);
  }
  return json({ error: { code: "FORBIDDEN", message: "You are not authorized to access documents." } }, 403);
}

export interface DocumentsApiDependencies {
  getAuthorization: () => Promise<AuthorizationResult>;
  parseListQuery: (params: Record<string, string | string[] | undefined>) => QueryValidationResult;
  listDocuments: (query: DocumentListQuery, viewer?: AuthorizedUser) => Promise<PaginatedDocuments>;
  isDocumentId: (value: string) => boolean;
  getDocumentById: (documentId: string, viewer?: AuthorizedUser) => Promise<DocumentRecord | null>;
}

export function createListDocumentsHandler(dependencies: Pick<DocumentsApiDependencies, "getAuthorization" | "parseListQuery" | "listDocuments">) {
  return async function GET(request: NextRequest) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return authorizationError(authorization.kind);

    const validation = dependencies.parseListQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!validation.success) {
      return json({ error: { code: "VALIDATION_ERROR", message: validation.message, field: validation.field } }, 400);
    }

    try {
      const result = await dependencies.listDocuments(validation.data, authorization.user);
      const visible = result.documents.filter((document) => canReadDocument(authorization.user, document));
      const removed = result.documents.length - visible.length;
      return json({ ...result, documents: visible, total: Math.max(0, result.total - removed) });
    } catch {
      logOperationalFailure({ operation: "documents.list", outcome: "failure", category: "REGISTRY_READ_FAILED", status: 500 });
      return json({ error: { code: "REGISTRY_ERROR", message: "Documents are temporarily unavailable. Please try again." } }, 500);
    }
  };
}

export function createGetDocumentHandler(dependencies: Pick<DocumentsApiDependencies, "getAuthorization" | "isDocumentId" | "getDocumentById">) {
  return async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return authorizationError(authorization.kind);

    const { id } = await params;
    if (!dependencies.isDocumentId(id)) {
      return json({ error: { code: "VALIDATION_ERROR", message: "Document ID is invalid.", field: "id" } }, 400);
    }

    try {
      const document = await dependencies.getDocumentById(id, authorization.user);
      if (!document || !canReadDocument(authorization.user, document)) {
        return json({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
      }
      return json({ document });
    } catch {
      logOperationalFailure({ operation: "documents.detail", outcome: "failure", category: "REGISTRY_READ_FAILED", status: 500, resourceId: id });
      return json({ error: { code: "REGISTRY_ERROR", message: "Document details are temporarily unavailable. Please try again." } }, 500);
    }
  };
}
