import { z } from "zod";
import { getAuthorization } from "@/lib/auth/server";
import { createLifecycleRepository, listDocumentLinks } from "@/lib/documents/lifecycle-repository";
import { isDocumentId } from "@/lib/documents/query";
import { detectSupersedeCycle } from "@/lib/documents/relationships";
import { getDocumentById } from "@/lib/documents/repository";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const createLinkSchema = z.object({
  to_id: z.string().uuid("Target document must be a valid UUID."),
  relation: z.enum(["RELATES_TO", "SUPERSEDES", "AMENDS"]),
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

  const links = await listDocumentLinks(await createClient(), id, authorization.user);
  return protectedJson({ links });
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

  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid link parameters." } }, 400);
  }

  if (id === parsed.data.to_id) {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "A document cannot link to itself." } }, 400);
  }

  const supabase = await createClient();
  const sourceDoc = await getDocumentById(supabase, id, authorization.user);
  const targetDoc = await getDocumentById(supabase, parsed.data.to_id, authorization.user);

  if (!sourceDoc || !targetDoc) {
    return protectedJson({ error: { code: "NOT_FOUND", message: "Source or target document not found." } }, 404);
  }

  if (parsed.data.relation === "SUPERSEDES") {
    const existingLinks = await listDocumentLinks(supabase, id, authorization.user);
    if (detectSupersedeCycle(existingLinks, id, parsed.data.to_id)) {
      return protectedJson({ error: { code: "SUPERSEDE_CYCLE_DETECTED", message: "Acyclic constraint violated: cyclic supersede relationship." } }, 400);
    }
  }

  try {
    const repository = createLifecycleRepository(createAdminClient());
    const link = await repository.addLink({
      actorId: authorization.user.id,
      fromId: id,
      toId: parsed.data.to_id,
      relation: parsed.data.relation,
    });
    return protectedJson({ link }, 201);
  } catch (err) {
    return protectedJson({ error: { code: "LINK_CREATION_FAILED", message: (err as Error).message || "Failed to create link." } }, 500);
  }
}
