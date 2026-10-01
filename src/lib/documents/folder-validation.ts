import { z } from "zod";
import { adminSubcategories, categoryUsesYear, isAdminCategory, type AdminCategory } from "./admin-categories";

const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const allowedName = /^[\p{L}\p{N}][\p{L}\p{N} ._&()'-]*$/u;

export class FolderValidationError extends Error {
  constructor(readonly field: string, message: string) { super(message); }
}

const requestSchema = z.object({
  document_type: z.string(),
  filing_year: z.number().int().nullable(),
  filing_subcategory: z.string(),
  name: z.string(),
  idempotency_key: z.string().uuid(),
}).strict();

export type ValidatedFolderRequest = {
  documentType: AdminCategory;
  filingYear: number | null;
  filingSubcategory: string;
  name: string;
  normalizedName: string;
  idempotencyKey: string;
};

export function normalizeFolderName(value: string): { name: string; normalizedName: string } {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new FolderValidationError("name", "Folder name contains unsupported characters.");
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name) throw new FolderValidationError("name", "Folder name is required.");
  if ([...name].length > 100) throw new FolderValidationError("name", "Folder name must not exceed 100 characters.");
  if (name.includes("/") || name.includes("\\") || name === "." || name === ".." || name.startsWith(".") || name.endsWith(".")) throw new FolderValidationError("name", "Folder name cannot be path-like.");
  if (!allowedName.test(name) || !/[\p{L}\p{N}]/u.test(name)) throw new FolderValidationError("name", "Folder name contains unsupported characters.");
  const normalizedName = name.normalize("NFKC").toLowerCase();
  if (reservedNames.test(normalizedName)) throw new FolderValidationError("name", "Folder name is reserved.");
  return { name, normalizedName };
}

export function validateFolderRequest(value: unknown): ValidatedFolderRequest {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new FolderValidationError("request", "Folder request is invalid.");
  const input = parsed.data;
  if (!isAdminCategory(input.document_type)) throw new FolderValidationError("document_type", "Select a valid Admin category.");
  if (categoryUsesYear(input.document_type)) {
    if (input.filing_year === null || input.filing_year < 1900 || input.filing_year > 9999) throw new FolderValidationError("filing_year", "A valid filing year is required.");
  } else if (input.filing_year !== null) throw new FolderValidationError("filing_year", "This category does not use a filing year.");
  const subcategories = adminSubcategories[input.document_type];
  if (subcategories && !subcategories.includes(input.filing_subcategory)) throw new FolderValidationError("filing_subcategory", "Select a valid subcategory.");
  if (!subcategories && input.filing_subcategory) throw new FolderValidationError("filing_subcategory", "This category does not use a subcategory.");
  return { documentType: input.document_type, filingYear: input.filing_year, filingSubcategory: input.filing_subcategory, idempotencyKey: input.idempotency_key, ...normalizeFolderName(input.name) };
}
