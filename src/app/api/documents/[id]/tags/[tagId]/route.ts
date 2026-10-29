import { getAuthorization } from "@/lib/auth/server";
import { createLifecycleRepository } from "@/lib/documents/lifecycle-repository";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  const { id, tagId } = await params;
  if (!isDocumentId(id) || !isDocumentId(tagId)) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid document or tag ID." } }, 400);
  }

  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE" || authorization.user.role === "VIEWER") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Staff or Administrator access required." } }, 403);
  }
  if (!isSameOrigin(request)) {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Cross-origin requests forbidden." } }, 403);
  }

  try {
    const repository = createLifecycleRepository(createAdminClient());
    const removed = await repository.removeTag({
      actorId: authorization.user.id,
      documentId: id,
      tagId,
    });
    return protectedJson({ removed });
  } catch (err) {
    return protectedJson({ error: { code: "TAG_REMOVAL_FAILED", message: (err as Error).message || "Failed to remove tag." } }, 500);
  }
}
