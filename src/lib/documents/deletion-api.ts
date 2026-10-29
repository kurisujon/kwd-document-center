import { z } from "zod";
import { isSameOrigin } from "../http/origin";
import { protectedJson } from "../http/response";
import type { AuthorizationResult, AuthorizedUser } from "../auth/types";
import { DocumentDeletionError } from "./delete-service";
import type { TrashedDocumentRecord } from "./deletion-repository";

function error(code: string, message: string, status: number, field?: string) {
  return protectedJson({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

async function requireActiveAdmin(
  getAuthorization: () => Promise<AuthorizationResult>,
): Promise<{ response: Response } | { user: AuthorizedUser }> {
  const authorization = await getAuthorization();
  if (authorization.kind !== "authorized") {
    return {
      response: error(
        authorization.kind === "unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN",
        authorization.kind === "unauthenticated"
          ? "Sign in is required."
          : "Administrator access is required.",
        authorization.kind === "unauthenticated" ? 401 : 403,
      ),
    };
  }
  if (authorization.user.role !== "ADMIN" || authorization.user.status !== "ACTIVE") {
    return { response: error("FORBIDDEN", "Administrator access is required.", 403) };
  }
  return { user: authorization.user };
}

const purgeRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "A purge reason is required.")
      .max(500, "Purge reason must be 500 characters or fewer."),
  })
  .strict();

export function createDeleteDocumentHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  isDocumentId: (id: string) => boolean;
  deleteDocument: (input: {
    documentId: string;
    actor: AuthorizedUser;
  }) => Promise<{ deleted: true; reused: boolean }>;
}) {
  return async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const auth = await requireActiveAdmin(dependencies.getAuthorization);
    if ("response" in auth) return auth.response;
    if (!isSameOrigin(request)) {
      return error("FORBIDDEN", "The request origin is not allowed.", 403);
    }
    const { id } = await params;
    if (!dependencies.isDocumentId(id)) {
      return error("VALIDATION_ERROR", "Document ID is invalid.", 400);
    }
    try {
      return protectedJson(
        await dependencies.deleteDocument({ documentId: id, actor: auth.user }),
      );
    } catch (cause) {
      if (cause instanceof DocumentDeletionError) {
        return error(cause.code, cause.message, cause.status);
      }
      return error("REGISTRY_ERROR", "Document deletion is temporarily unavailable.", 503);
    }
  };
}

export function createListTrashedDocumentsHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  listTrashedDocuments: (input: { actor: AuthorizedUser }) => Promise<TrashedDocumentRecord[]>;
}) {
  return async function GET() {
    const auth = await requireActiveAdmin(dependencies.getAuthorization);
    if ("response" in auth) return auth.response;
    try {
      const documents = await dependencies.listTrashedDocuments({ actor: auth.user });
      return protectedJson({ documents }, 200);
    } catch (cause) {
      if (cause instanceof DocumentDeletionError) {
        return error(cause.code, cause.message, cause.status);
      }
      return error("REGISTRY_ERROR", "Trash records are temporarily unavailable.", 503);
    }
  };
}

export function createRestoreDocumentHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  isDocumentId: (id: string) => boolean;
  restoreDocument: (input: {
    documentId: string;
    actor: AuthorizedUser;
  }) => Promise<{ restored: true; reused: boolean }>;
}) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const auth = await requireActiveAdmin(dependencies.getAuthorization);
    if ("response" in auth) return auth.response;
    if (!isSameOrigin(request)) {
      return error("FORBIDDEN", "The request origin is not allowed.", 403);
    }
    const { id } = await params;
    if (!dependencies.isDocumentId(id)) {
      return error("VALIDATION_ERROR", "Document ID is invalid.", 400);
    }
    try {
      return protectedJson(
        await dependencies.restoreDocument({ documentId: id, actor: auth.user }),
      );
    } catch (cause) {
      if (cause instanceof DocumentDeletionError) {
        return error(cause.code, cause.message, cause.status);
      }
      return error("REGISTRY_ERROR", "Document restore is temporarily unavailable.", 503);
    }
  };
}

export function createPurgeDocumentHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  isDocumentId: (id: string) => boolean;
  purgeDocument: (input: {
    documentId: string;
    actor: AuthorizedUser;
    reason: string;
  }) => Promise<{ purged: true; reused: boolean }>;
}) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const auth = await requireActiveAdmin(dependencies.getAuthorization);
    if ("response" in auth) return auth.response;
    if (!isSameOrigin(request)) {
      return error("FORBIDDEN", "The request origin is not allowed.", 403);
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return error("VALIDATION_ERROR", "JSON request body is required.", 400);
    }

    const { id } = await params;
    if (!dependencies.isDocumentId(id)) {
      return error("VALIDATION_ERROR", "Document ID is invalid.", 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return error("VALIDATION_ERROR", "The JSON request body is invalid.", 400);
    }

    const parsed = purgeRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return error(
        "VALIDATION_ERROR",
        issue?.message ?? "A valid purge reason is required.",
        400,
        "reason",
      );
    }

    try {
      return protectedJson(
        await dependencies.purgeDocument({
          documentId: id,
          actor: auth.user,
          reason: parsed.data.reason,
        }),
      );
    } catch (cause) {
      if (cause instanceof DocumentDeletionError) {
        return error(cause.code, cause.message, cause.status);
      }
      return error("REGISTRY_ERROR", "Document purge is temporarily unavailable.", 503);
    }
  };
}
