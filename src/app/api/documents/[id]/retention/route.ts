import { z } from "zod";
import { getAuthorization } from "@/lib/auth/server";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { approveRetentionAction } from "@/lib/retention/retention-service";
import { createAdminClient } from "@/lib/supabase/admin";

const postRetentionSchema = z
  .object({
    action: z.enum(["ARCHIVE", "DISPOSE"]),
    notes: z.string().max(1000).optional(),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  if (authorization.user.role !== "ADMIN") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Administrator role required for retention approval." } }, 403);
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

  const parsed = postRetentionSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid retention payload." } },
      400,
    );
  }

  try {
    const adminClient = createAdminClient();
    const result = await approveRetentionAction(adminClient, {
      actorId: authorization.user.id,
      documentId: id,
      action: parsed.data.action,
      notes: parsed.data.notes,
    });
    return protectedJson({ success: true, retention: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retention approval failed.";
    if (message.includes("DOCUMENT_NOT_FOUND")) {
      return protectedJson({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
    }
    return protectedJson({ error: { code: "RETENTION_APPROVAL_FAILED", message } }, 500);
  }
}
