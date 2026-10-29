import { z } from "zod";
import { getAuthorization } from "@/lib/auth/server";
import { isStatusTransitionAllowed } from "@/lib/documents/document-types-config";
import { createLifecycleRepository } from "@/lib/documents/lifecycle-repository";
import { isDocumentId } from "@/lib/documents/query";
import { getDocumentById } from "@/lib/documents/repository";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const patchStatusSchema = z.object({
  status: z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUPERSEDED", "ARCHIVED"]),
  reason: z.string().max(500).optional(),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDocumentId(id)) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid document ID." } }, 400);
  }

  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }
  if (!isSameOrigin(request)) {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Cross-origin requests forbidden." } }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body." } }, 400);
  }

  const parsed = patchStatusSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid status." } }, 400);
  }

  const targetDoc = await getDocumentById(await createClient(), id, authorization.user);
  if (!targetDoc) {
    return protectedJson({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
  }

  const check = isStatusTransitionAllowed(targetDoc.status, parsed.data.status, authorization.user.role);
  if (!check.allowed) {
    return protectedJson({ error: { code: "INVALID_STATUS_TRANSITION", message: check.reason ?? "Status transition not allowed." } }, 400);
  }

  try {
    const repository = createLifecycleRepository(createAdminClient());
    const result = await repository.changeStatus({
      actorId: authorization.user.id,
      documentId: id,
      newStatus: parsed.data.status,
      reason: parsed.data.reason,
    });
    return protectedJson({ document: result });
  } catch (err) {
    return protectedJson({ error: { code: "STATUS_CHANGE_FAILED", message: (err as Error).message || "Failed to change document status." } }, 500);
  }
}
