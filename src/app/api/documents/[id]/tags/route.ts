import { z } from "zod";
import { getAuthorization } from "@/lib/auth/server";
import { createLifecycleRepository, listDocumentTags } from "@/lib/documents/lifecycle-repository";
import { isDocumentId } from "@/lib/documents/query";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const createTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().trim().min(1).max(20).optional(),
}).strict();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const tags = await listDocumentTags(await createClient(), id, authorization.user);
  return protectedJson({ tags });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDocumentId(id)) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid document ID." } }, 400);
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body." } }, 400);
  }

  const parsed = createTagSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid tag." } }, 400);
  }

  try {
    const repository = createLifecycleRepository(createAdminClient());
    const tag = await repository.addTag({
      actorId: authorization.user.id,
      documentId: id,
      tagName: parsed.data.name,
      tagColor: parsed.data.color,
    });
    return protectedJson({ tag }, 201);
  } catch (err) {
    return protectedJson({ error: { code: "TAG_CREATION_FAILED", message: (err as Error).message || "Failed to add tag." } }, 500);
  }
}
