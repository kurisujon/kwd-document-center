import { isSameOrigin } from "../http/origin";
import { protectedJson } from "../http/response";
import type { AuthorizationResult } from "../auth/types";
import { DocumentDeletionError } from "./delete-service";

function error(code: string, message: string, status: number) { return protectedJson({ error: { code, message } }, status); }

export function createDeleteDocumentHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  isDocumentId: (id: string) => boolean;
  deleteDocument: (input: { documentId: string; actor: Extract<AuthorizationResult, { kind: "authorized" }> ["user"] }) => Promise<{ deleted: true; reused: boolean }>;
}) {
  return async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind !== "authorized") return error(authorization.kind === "unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN", authorization.kind === "unauthenticated" ? "Sign in is required." : "Administrator access is required.", authorization.kind === "unauthenticated" ? 401 : 403);
    if (authorization.user.role !== "ADMIN") return error("FORBIDDEN", "Administrator access is required.", 403);
    if (!isSameOrigin(request)) return error("FORBIDDEN", "The request origin is not allowed.", 403);
    const { id } = await params;
    if (!dependencies.isDocumentId(id)) return error("VALIDATION_ERROR", "Document ID is invalid.", 400);
    try {
      return protectedJson(await dependencies.deleteDocument({ documentId: id, actor: authorization.user }));
    } catch (cause) {
      if (cause instanceof DocumentDeletionError) return error(cause.code, cause.message, cause.status);
      return error("REGISTRY_ERROR", "Document deletion is temporarily unavailable.", 503);
    }
  };
}
