import { z } from "zod";
import { adminSubcategories, isAdminCategory, type AdminCategory } from "./admin-categories";
import { FolderValidationError, normalizeFolderName } from "./folder-validation";

export const hierarchyKinds = ["YEAR", "CATEGORY", "SUBCATEGORY", "WORKING_FOLDER"] as const;
export type HierarchyKind = (typeof hierarchyKinds)[number];

const schema = z.object({ parent_ref: z.string().min(1), kind: z.enum(hierarchyKinds), filing_year: z.number().int().nullable().optional(), category: z.string().nullable().optional(), subcategory: z.string().nullable().optional(), name: z.string(), idempotency_key: z.string().uuid() }).strict();

export type HierarchyRequest = { parentRef: string; kind: HierarchyKind; filingYear: number | null; category: AdminCategory | null; subcategory: string | null; name: string; normalizedName: string; idempotencyKey: string };

export function validateHierarchyRequest(value: unknown): HierarchyRequest {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new FolderValidationError("request", "Hierarchy request is invalid.");
  const input = parsed.data;
  const year = input.filing_year ?? null;
  if (input.kind === "YEAR") {
    if (!/^department:ADMIN$/.test(input.parent_ref) || year === null || year < 2000 || year > 2100 || input.category || input.subcategory) throw new FolderValidationError("request", "Year creation request is invalid.");
    return { parentRef: input.parent_ref, kind: input.kind, filingYear: year, category: null, subcategory: null, idempotencyKey: input.idempotency_key, ...normalizeFolderName(String(year)) };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.parent_ref)) throw new FolderValidationError("parent_ref", "Parent folder is invalid.");
  if (input.kind === "CATEGORY") {
    if (!isAdminCategory(input.category ?? "") || input.subcategory || year === null) throw new FolderValidationError("category", "Category creation request is invalid.");
    const category = input.category as AdminCategory;
    return { parentRef: input.parent_ref, kind: input.kind, filingYear: year, category, subcategory: null, idempotencyKey: input.idempotency_key, ...normalizeFolderName(category) };
  }
  if (input.kind === "SUBCATEGORY") {
    const category = input.category as AdminCategory;
    const subcategory = input.subcategory as string;
    if (!isAdminCategory(input.category ?? "") || !subcategory || !adminSubcategories[category]?.includes(subcategory) || year === null) throw new FolderValidationError("subcategory", "Subcategory creation request is invalid.");
    return { parentRef: input.parent_ref, kind: input.kind, filingYear: year, category, subcategory, idempotencyKey: input.idempotency_key, ...normalizeFolderName(subcategory) };
  }
  if (year === null || !isAdminCategory(input.category ?? "")) throw new FolderValidationError("request", "Working folder creation request is invalid.");
  const name = normalizeFolderName(input.name);
  return { parentRef: input.parent_ref, kind: input.kind, filingYear: year, category: input.category as AdminCategory, subcategory: input.subcategory ?? null, idempotencyKey: input.idempotency_key, ...name };
}
