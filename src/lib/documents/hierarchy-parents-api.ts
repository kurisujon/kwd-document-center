import type { AuthorizationResult } from "../auth/types";
import { protectedJson } from "../http/response";
import { adminSubcategories } from "./admin-categories";
import type { HierarchyFolderRecord } from "./hierarchy-repository";
import type { HierarchyKind } from "./hierarchy-validation";

type ChildKind = HierarchyKind;
type ParentOption = { parentRef: string; kind: "DEPARTMENT" | "YEAR" | "CATEGORY" | "SUBCATEGORY"; label: string; filingYear: number | null; category: string | null; subcategory: string | null };
type Dependencies = { getAuthorization: () => Promise<AuthorizationResult>; getAdminDepartment: () => { enabled: boolean; label: string }; listActiveHierarchyFolders: (options: { departmentKey: string; kinds: Array<"YEAR" | "CATEGORY" | "SUBCATEGORY"> }) => Promise<HierarchyFolderRecord[]> };

function error(code: string, message: string, status: number) { return protectedJson({ error: { code, message } }, status); }
function toOption(folder: HierarchyFolderRecord): ParentOption { return { parentRef: folder.id, kind: folder.hierarchyKind as "YEAR" | "CATEGORY" | "SUBCATEGORY", label: folder.name, filingYear: folder.filingYear, category: folder.category, subcategory: folder.subcategory }; }
function sortOptions(kind: ChildKind, options: ParentOption[]) { return options.sort((left, right) => kind === "CATEGORY" ? (right.filingYear ?? -Infinity) - (left.filingYear ?? -Infinity) || left.label.localeCompare(right.label) : left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label)); }

export function createHierarchyParentOptionsHandler(dependencies: Dependencies) {
  return async function GET(request: Request) {
    const authorization = await dependencies.getAuthorization();
    if (authorization.kind === "unauthenticated") return error("UNAUTHORIZED", "Sign in is required.", 401);
    if (authorization.kind !== "authorized" || authorization.user.role !== "ADMIN" || authorization.user.status !== "ACTIVE") return error("FORBIDDEN", "Administrator access is required.", 403);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "department" && key !== "childKind")) return error("VALIDATION_ERROR", "Parent options request is invalid.", 400);
    const department = url.searchParams.get("department");
    const childKind = url.searchParams.get("childKind");
    if (department !== "ADMIN" || !childKind || !(["YEAR", "CATEGORY", "SUBCATEGORY", "WORKING_FOLDER"] as const).includes(childKind as ChildKind)) return error("VALIDATION_ERROR", "Parent options request is invalid.", 400);
    if (childKind === "YEAR") {
      const admin = dependencies.getAdminDepartment();
      if (!admin.enabled) return error("DEPARTMENT_UNAVAILABLE", "The Admin hierarchy is unavailable.", 403);
      return protectedJson({ options: [{ parentRef: "department:ADMIN", kind: "DEPARTMENT", label: admin.label, filingYear: null, category: null, subcategory: null }] satisfies ParentOption[] });
    }
    const kinds = childKind === "CATEGORY" ? ["YEAR"] as const : childKind === "SUBCATEGORY" ? ["CATEGORY"] as const : ["CATEGORY", "SUBCATEGORY"] as const;
    try {
      let folders = (await dependencies.listActiveHierarchyFolders({ departmentKey: "ADMIN", kinds: [...kinds] })).filter((folder) => (kinds as readonly string[]).includes(folder.hierarchyKind ?? ""));
      if (childKind === "SUBCATEGORY") folders = folders.filter((folder) => folder.hierarchyKind === "CATEGORY" && !!folder.category && !!adminSubcategories[folder.category as keyof typeof adminSubcategories]?.length);
      return protectedJson({ options: sortOptions(childKind as ChildKind, folders.filter((folder) => folder.status === "ACTIVE" && folder.hierarchyKind !== null).map(toOption)) });
    } catch {
      return error("REGISTRY_ERROR", "Hierarchy parents are temporarily unavailable.", 500);
    }
  };
}
