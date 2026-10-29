import { getAuthorization } from "@/lib/auth/server";
import { createLifecycleRepository } from "@/lib/documents/lifecycle-repository";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id, linkId } = await params;
  if (!isDocumentId(id) || !isDocumentId(linkId)) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid document or link ID." } }, 400);
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
    const removed = await repository.removeLink({
      actorId: authorization.user.id,
      linkId,
    });
    return protectedJson({ removed });
  } catch (err) {
    return protectedJson({ error: { code: "LINK_DELETION_FAILED", message: (err as Error).message || "Failed to delete link." } }, 500);
  }
}
