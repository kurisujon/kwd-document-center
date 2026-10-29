import { z } from "zod";
import { processApprovalDecision } from "@/lib/approvals/approval-service";
import { getAuthorization } from "@/lib/auth/server";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";

const decisionSchema = z.object({
  action: z.enum(["APPROVE", "RETURN"]),
  notes: z.string().max(2000).optional(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const { id, stepId } = await params;
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
  if (authorization.user.role !== "ADMIN" && authorization.user.role !== "STAFF") {
    return protectedJson(
      { error: { code: "FORBIDDEN", message: "Staff or Admin role required to sign off." } },
      403,
    );
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

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid decision payload." } },
      400,
    );
  }

  try {
    const adminClient = createAdminClient();
    const result = await processApprovalDecision(
      adminClient,
      authorization.user,
      stepId,
      parsed.data.action,
      parsed.data.notes,
    );
    return protectedJson({ decision: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process approval decision.";
    if (message.includes("PRIOR_STEP_UNAPPROVED")) {
      return protectedJson(
        { error: { code: "PRIOR_STEP_UNAPPROVED", message: "Previous approval steps must be completed first." } },
        400,
      );
    }
    if (message.includes("UNAUTHORIZED_APPROVER") || message.includes("UNAUTHORIZED_APPROVER_ROLE")) {
      return protectedJson(
        { error: { code: "FORBIDDEN", message: "You are not authorized to act on this approval step." } },
        403,
      );
    }
    if (message.includes("DOCUMENT_ACCESS_DENIED")) {
      return protectedJson({ error: { code: "FORBIDDEN", message: "Access denied to document." } }, 403);
    }
    if (message.includes("STEP_NOT_FOUND")) {
      return protectedJson({ error: { code: "NOT_FOUND", message: "Approval step not found." } }, 404);
    }
    if (message.includes("STEP_ALREADY_PROCESSED")) {
      return protectedJson(
        { error: { code: "CONFLICT", message: "This approval step has already been completed." } },
        409,
      );
    }
    return protectedJson({ error: { code: "DECISION_FAILED", message } }, 500);
  }
}
