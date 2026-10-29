import { getAuthorization } from "@/lib/auth/server";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { isDocumentStarred, toggleDocumentStar } from "@/lib/stars/star-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
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
    const starred = await isDocumentStarred(supabase, authorization.user.id, id);
    return protectedJson({ documentId: id, starred });
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to check star status." } },
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
  if (!isSameOrigin(request)) {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Cross-origin requests forbidden." } }, 403);
  }

  try {
    const adminClient = createAdminClient();
    const result = await toggleDocumentStar(adminClient, authorization.user.id, id);
    return protectedJson(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to toggle star.";
    if (message.includes("DOCUMENT_ACCESS_DENIED")) {
      return protectedJson({ error: { code: "FORBIDDEN", message: "Access denied to document." } }, 403);
    }
    if (message.includes("DOCUMENT_NOT_FOUND")) {
      return protectedJson({ error: { code: "NOT_FOUND", message: "Document not found." } }, 404);
    }
    return protectedJson({ error: { code: "STAR_FAILED", message } }, 500);
  }
}
