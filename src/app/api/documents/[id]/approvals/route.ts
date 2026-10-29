import { z } from "zod";
import { getDocumentApprovalSteps, startDocumentApproval } from "@/lib/approvals/approval-service";
import { getAuthorization } from "@/lib/auth/server";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const customStepSchema = z.object({
  step_number: z.number().int().positive(),
  title: z.string().min(1).max(150),
  role: z.enum(["STAFF", "ADMIN"]),
  approver_id: z.string().uuid().optional(),
});

const startApprovalSchema = z.object({
  customSteps: z.array(customStepSchema).min(1).max(10).optional(),
}).strict();

export async function GET(
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

  try {
    const supabase = await createClient();
    const steps = await getDocumentApprovalSteps(supabase, authorization.user, id);
    return protectedJson({ steps });
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to load approval steps." } },
      500,
    );
  }
}

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
  if (authorization.user.role !== "ADMIN" && authorization.user.role !== "STAFF") {
    return protectedJson(
      { error: { code: "FORBIDDEN", message: "Staff or Admin role required to start approval route." } },
      403,
    );
  }
  if (!isSameOrigin(request)) {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Cross-origin requests forbidden." } }, 403);
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body." } }, 400);
  }

  const parsed = startApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid approval parameters." } },
      400,
    );
  }

  try {
    const adminClient = createAdminClient();
    const steps = await startDocumentApproval(
      adminClient,
      authorization.user,
      id,
      parsed.data.customSteps,
    );
    return protectedJson({ steps }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start approval route.";
    if (message.includes("DOCUMENT_ACCESS_DENIED")) {
      return protectedJson({ error: { code: "FORBIDDEN", message: "Access denied to document." } }, 403);
    }
    if (message.includes("DOCUMENT_NOT_FOUND")) {
      return protectedJson({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
    }
    return protectedJson({ error: { code: "OPERATION_FAILED", message } }, 500);
  }
}
