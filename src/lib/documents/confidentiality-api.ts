import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AuthorizationResult, AuthorizedUser } from "../auth/types";
import { isSameOrigin } from "../http/origin";
import { protectedJson } from "../http/response";
import { logOperationalFailure } from "../observability/log";

const patchConfidentialSchema = z.object({
  confidential: z.boolean(),
}).strict();

export type ConfidentialityUpdateOutcome =
  | { outcome: "UPDATED"; confidential: boolean }
  | { outcome: "NOT_FOUND"; confidential: false };

export interface ConfidentialityRepository {
  setConfidential(input: { documentId: string; actorId: string; confidential: boolean }): Promise<ConfidentialityUpdateOutcome>;
}

export function createConfidentialityRepository(client: SupabaseClient): ConfidentialityRepository {
  return {
    async setConfidential({ documentId, actorId, confidential }) {
      const { data, error } = await client.rpc("admin_set_document_confidential", {
        p_document_id: documentId,
        p_actor_id: actorId,
        p_confidential: confidential,
      });
      if (error) throw new Error("CONFIDENTIALITY_RPC_FAILED");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || (row.outcome !== "UPDATED" && row.outcome !== "NOT_FOUND")) {
        throw new Error("CONFIDENTIALITY_RPC_INVALID_RESPONSE");
      }
      if (row.outcome === "NOT_FOUND") return { outcome: "NOT_FOUND", confidential: false };
      return { outcome: "UPDATED", confidential: Boolean(row.confidential) };
    },
  };
}

function jsonError(code: string, message: string, status: number, field?: string) {
  return protectedJson({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

export function createPatchDocumentConfidentialityHandler(dependencies: {
  getAuthorization: () => Promise<AuthorizationResult>;
  isDocumentId: (value: string) => boolean;
  setDocumentConfidentiality: (input: { documentId: string; actor: AuthorizedUser; confidential: boolean }) => Promise<ConfidentialityUpdateOutcome>;
}) {
  return async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind === "unauthenticated") {
      return jsonError("UNAUTHORIZED", "Sign in is required to update document access.", 401);
    }
    if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE" || authorization.user.role !== "ADMIN") {
      return jsonError("FORBIDDEN", "Administrator access is required to update document confidentiality.", 403);
    }
    if (!isSameOrigin(request)) {
      return jsonError("FORBIDDEN", "Cross-origin document confidentiality requests are not allowed.", 403);
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonError("VALIDATION_ERROR", "JSON request body is required.", 400);
    }

    const { id } = await params;
    if (!dependencies.isDocumentId(id)) {
      return jsonError("VALIDATION_ERROR", "Document ID is invalid.", 400, "id");
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError("VALIDATION_ERROR", "Malformed JSON request body.", 400);
    }

    const parsed = patchConfidentialSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "A boolean confidential value is required.", 400, "confidential");
    }

    try {
      const result = await dependencies.setDocumentConfidentiality({
        documentId: id,
        actor: authorization.user,
        confidential: parsed.data.confidential,
      });
      if (result.outcome === "NOT_FOUND") {
        return jsonError("NOT_FOUND", "Document not found.", 404);
      }
      return protectedJson({
        document: {
          document_id: id,
          confidential: result.confidential,
        },
      });
    } catch {
      logOperationalFailure({
        operation: "documents.confidentiality",
        outcome: "failure",
        category: "CONFIDENTIALITY_UPDATE_FAILED",
        status: 500,
        resourceId: id,
      });
      return jsonError("REGISTRY_ERROR", "The document access setting could not be updated. Please retry.", 500);
    }
  };
}
