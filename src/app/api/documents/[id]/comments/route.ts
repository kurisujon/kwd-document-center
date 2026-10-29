import { z } from "zod";
import { getAuthorization } from "@/lib/auth/server";
import { addDocumentComment, listDocumentComments } from "@/lib/comments/comment-service";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const postCommentSchema = z
  .object({
    content: z.string().min(1, "Comment cannot be empty.").max(2000, "Comment cannot exceed 2000 characters."),
  })
  .strict();

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
    const comments = await listDocumentComments(supabase, authorization.user, id);
    return protectedJson({ comments });
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to load comments." } },
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
    return protectedJson({ error: { code: "FORBIDDEN", message: "Staff or Admin role required to comment." } }, 403);
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

  const parsed = postCommentSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid comment content." } },
      400,
    );
  }

  try {
    const adminClient = createAdminClient();
    const comment = await addDocumentComment(adminClient, authorization.user, id, parsed.data.content);
    return protectedJson({ comment }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to post comment.";
    if (message.includes("DOCUMENT_ACCESS_DENIED")) {
      return protectedJson({ error: { code: "FORBIDDEN", message: "Access denied to document." } }, 403);
    }
    if (message.includes("DOCUMENT_NOT_FOUND")) {
      return protectedJson({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
    }
    return protectedJson({ error: { code: "CREATE_FAILED", message } }, 500);
  }
}
