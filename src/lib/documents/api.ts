import type { AuthorizationResult } from "../auth/types";
import type { NextRequest } from "next/server";
import type { QueryValidationResult } from "./query";
import type { DocumentListQuery, DocumentRecord, PaginatedDocuments } from "./types";

type AuthorizationFailure = Exclude<AuthorizationResult["kind"], "authorized">;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
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
  listDocuments: (query: DocumentListQuery) => Promise<PaginatedDocuments>;
  isDocumentId: (value: string) => boolean;
  getDocumentById: (documentId: string) => Promise<DocumentRecord | null>;
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
      return json(await dependencies.listDocuments(validation.data));
    } catch {
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
      const document = await dependencies.getDocumentById(id);
      if (!document) return json({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
      return json({ document });
    } catch {
      return json({ error: { code: "REGISTRY_ERROR", message: "Document details are temporarily unavailable. Please try again." } }, 500);
    }
  };
}
