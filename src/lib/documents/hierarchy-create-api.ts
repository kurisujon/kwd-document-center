import { z } from "zod";
import type { AuthorizationResult } from "../auth/types";
import { isSameOrigin } from "../http/origin";
import { protectedJson } from "../http/response";
import { HierarchyServiceError, type ClaimHierarchyCreationInput, type HierarchyCreationInternalResult } from "./hierarchy-service";

const schema = z.object({ departmentKey: z.literal("ADMIN"), parentRef: z.string().min(1), childKind: z.enum(["YEAR", "CATEGORY", "SUBCATEGORY", "WORKING_FOLDER"]), idempotencyKey: z.string().uuid(), requestedFilingYear: z.unknown().optional(), requestedCategory: z.unknown().optional(), requestedSubcategory: z.unknown().optional(), requestedName: z.unknown().optional() }).strict().superRefine((value, context) => {
  const required = value.childKind === "YEAR" ? "requestedFilingYear" : value.childKind === "CATEGORY" ? "requestedCategory" : value.childKind === "SUBCATEGORY" ? "requestedSubcategory" : "requestedName";
  if (value[required as keyof typeof value] === undefined) context.addIssue({ code: "custom", message: "Hierarchy child value is required.", path: [required] });
});

type Dependencies = { getAuthorization: () => Promise<AuthorizationResult>; createHierarchyFolderInternal: (input: ClaimHierarchyCreationInput) => Promise<HierarchyCreationInternalResult>; legacyPost: (request: Request) => Promise<Response> };
function error(code: string, message: string, status: number) { return protectedJson({ error: { code, message } }, status); }
function folder(id: string | null, metadata: { hierarchyKind: string; name: string; filingYear: number; category: string | null; subcategory: string | null }) { return id ? { id, kind: metadata.hierarchyKind, name: metadata.name, filingYear: metadata.filingYear, category: metadata.category, subcategory: metadata.subcategory } : undefined; }
function hierarchyError(errorValue: unknown) {
  if (!(errorValue instanceof HierarchyServiceError)) return error("INTERNAL_ERROR", "Hierarchy creation is temporarily unavailable.", 500);
  if (errorValue.code === "DUPLICATE_FOLDER") return error("DUPLICATE_FOLDER", "A folder with this name already exists in the selected hierarchy parent.", 409);
  if (errorValue.code === "OPERATION_NOT_OWNED") return error("IN_PROGRESS", "Hierarchy creation is already in progress.", 409);
  if (["INVALID_PARENT", "INVALID_HIERARCHY", "INVALID_YEAR", "INVALID_CATEGORY", "INVALID_SUBCATEGORY", "INVALID_FOLDER_NAME", "INVALID_IDEMPOTENCY"].includes(errorValue.code)) return error("INVALID_REQUEST", "Hierarchy creation request is invalid.", 400);
  return error("CREATION_UNAVAILABLE", "Hierarchy creation is temporarily unavailable.", 500);
}

export function createFoldersPostHandler(dependencies: Dependencies) {
  return async function POST(request: Request) {
    let body: unknown;
    try { body = await request.clone().json(); } catch { return dependencies.legacyPost(request); }
    if (!body || typeof body !== "object" || !Object.hasOwn(body, "childKind")) return dependencies.legacyPost(request);
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind === "unauthenticated") return error("UNAUTHORIZED", "Sign in is required.", 401);
    if (authorization.kind !== "authorized" || authorization.user.role !== "ADMIN" || authorization.user.status !== "ACTIVE") return error("FORBIDDEN", "Administrator access is required.", 403);
    if (!isSameOrigin(request)) return error("FORBIDDEN", "The request origin is not allowed.", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error("VALIDATION_ERROR", "JSON content is required.", 400);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return error("VALIDATION_ERROR", "Hierarchy creation request is invalid.", 400);
    try {
      const { childKind, ...request } = parsed.data;
      const result = await dependencies.createHierarchyFolderInternal({ ...request, kind: childKind, actorId: authorization.user.id });
      if (result.status === "ACTIVE") return protectedJson({ status: "ACTIVE", folder: folder(result.folderId, result.metadata) }, 201);
      if (result.status === "ACTIVE_EXISTING") return protectedJson({ status: "ACTIVE_EXISTING", folder: folder(result.folderId, result.metadata) }, 200);
      if (result.status === "IN_PROGRESS") return protectedJson({ status: "IN_PROGRESS", ...(result.folderId ? { folder: folder(result.folderId, result.metadata) } : {}) }, 202);
      if (result.status === "LEFT_CREATING") return protectedJson({ status: "IN_PROGRESS" }, 202);
      return error("CREATION_FAILED", "Hierarchy creation could not be completed.", 409);
    } catch (errorValue) { return hierarchyError(errorValue); }
  };
}
