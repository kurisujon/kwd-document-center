import { z } from "zod";
import { adminSubcategories, categoryUsesYear, isAdminCategory } from "./admin-categories";
import { adminUploadFormats, type AdminUploadExtension } from "./upload-formats";
import { validateCanonicalSourceRelativePath } from "./folder-upload-validation";
import { defaultAdminUploadMaxBytes } from "./upload-limits";
import type { AdminDocumentMetadata, FolderUploadRequestMetadata, ValidatedAdminUpload, ValidatedFolderUpload } from "./upload-types";

export { defaultAdminUploadMaxBytes } from "./upload-limits";

export class UploadValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

const uuidSchema = z.string().uuid("A valid idempotency key is required.");
const dateSchema = z.iso.date("Document date must be a valid date.");

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function submittedText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export function getAdminUploadMaxBytes(): number {
  const configured = process.env.ADMIN_UPLOAD_MAX_BYTES;
  if (!configured) return defaultAdminUploadMaxBytes;
  const parsed = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("ADMIN_UPLOAD_MAX_BYTES must be a positive integer.");
  }
  return parsed;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function includesBytes(bytes: Uint8Array, expected: Uint8Array): boolean {
  return bytes.some((_, start) => expected.every((byte, offset) => bytes[start + offset] === byte));
}

function utf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

function isSafeUtf8Text(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !decoded.includes("\u0000")
      && [...decoded].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 0x20 || character === "\t" || character === "\n" || character === "\r";
      });
  } catch {
    return false;
  }
}

function validateFileName(name: string): string {
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new UploadValidationError("file", "The file name contains unsupported characters.");
  }
  const baseName = name.replace(/[/\\]/g, "").trim();
  if (!baseName || baseName === "." || baseName === ".." || baseName.length > 240) {
    throw new UploadValidationError("file", "The file name is invalid.");
  }
  return baseName;
}

export async function validateAdminUploadFile(file: File) {
  const name = validateFileName(file.name);
  if (file.size < 1) throw new UploadValidationError("file", "Select a non-empty file.");
  if (file.size > getAdminUploadMaxBytes()) {
    throw new UploadValidationError("file", `The file must not exceed ${Math.floor(getAdminUploadMaxBytes() / 1024 / 1024)} MiB.`);
  }

  const extension = name.slice(name.lastIndexOf(".")).toLowerCase() as AdminUploadExtension;
  const format = adminUploadFormats[extension];
  if (!format) throw new UploadValidationError("file", "This file type is not supported.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (format.content !== "text" && !format.signatures.some((signature) => startsWith(bytes, [...signature]))) {
    throw new UploadValidationError("file", "The selected file does not match its file type.");
  }
  if (format.content === "zip" && !format.markers.some((marker) => includesBytes(bytes, new TextEncoder().encode(marker)))) {
    throw new UploadValidationError("file", "The selected Office file does not match its file type.");
  }
  if (format.content === "ole" && !format.markers.some((marker) => includesBytes(bytes, utf16Le(marker)))) {
    throw new UploadValidationError("file", "The selected Office file does not match its file type.");
  }
  if (format.content === "text" && !isSafeUtf8Text(bytes)) {
    throw new UploadValidationError("file", "The selected text file contains invalid or binary content.");
  }

  const declaredMimeType = file.type.split(";", 1)[0].trim().toLowerCase();
  const octetStreamAllowed = format.content !== "text" && declaredMimeType === "application/octet-stream";
  const compatibleMimeType = "compatibleMimeTypes" in format && format.compatibleMimeTypes.some((mimeType) => mimeType === declaredMimeType);
  if (declaredMimeType && declaredMimeType !== format.mimeType && !compatibleMimeType && !octetStreamAllowed) {
    throw new UploadValidationError("file", "The selected file has inconsistent type information.");
  }
  return { name, mimeType: format.mimeType, size: file.size, bytes };
}

function validateFolderMetadata(formData: FormData): FolderUploadRequestMetadata {
  const documentDate = dateSchema.safeParse(text(formData, "document_date"));
  if (!documentDate.success) throw new UploadValidationError("document_date", documentDate.error.issues[0].message);
  const subject = text(formData, "subject");
  if (!subject || subject.length > 500) throw new UploadValidationError("subject", "Subject is required and must not exceed 500 characters.");
  const documentNumber = text(formData, "document_number");
  const personsInvolved = text(formData, "persons_involved");
  if (documentNumber.length > 150) throw new UploadValidationError("document_number", "Document number must not exceed 150 characters.");
  if (personsInvolved.length > 500) throw new UploadValidationError("persons_involved", "Persons involved must not exceed 500 characters.");
  return { document_number: documentNumber, document_date: documentDate.data, subject, persons_involved: personsInvolved };
}

function validateMetadata(formData: FormData): AdminDocumentMetadata {
  const documentType = text(formData, "document_type");
  if (!isAdminCategory(documentType)) throw new UploadValidationError("document_type", "Select a valid Admin category.");

  const documentDate = dateSchema.safeParse(text(formData, "document_date"));
  if (!documentDate.success) throw new UploadValidationError("document_date", documentDate.error.issues[0].message);

  const subject = text(formData, "subject");
  if (!subject || subject.length > 500) throw new UploadValidationError("subject", "Subject is required and must not exceed 500 characters.");

  const documentNumber = text(formData, "document_number");
  const personsInvolved = text(formData, "persons_involved");
  if (documentNumber.length > 150) throw new UploadValidationError("document_number", "Document number must not exceed 150 characters.");
  if (personsInvolved.length > 500) throw new UploadValidationError("persons_involved", "Persons involved must not exceed 500 characters.");

  const yearText = text(formData, "filing_year");
  let filingYear: number | null = null;
  if (categoryUsesYear(documentType)) {
    if (!/^\d{4}$/.test(yearText)) throw new UploadValidationError("filing_year", "A four-digit filing year is required.");
    filingYear = Number(yearText);
    if (filingYear < 1900 || filingYear > 9999) throw new UploadValidationError("filing_year", "Filing year is invalid.");
  } else if (yearText) {
    throw new UploadValidationError("filing_year", "This category does not use a filing year.");
  }

  const filingSubcategory = text(formData, "filing_subcategory");
  const permittedSubcategories = adminSubcategories[documentType];
  if (permittedSubcategories && !permittedSubcategories.includes(filingSubcategory)) {
    throw new UploadValidationError("filing_subcategory", "Select a valid subcategory.");
  }
  if (!permittedSubcategories && filingSubcategory) {
    throw new UploadValidationError("filing_subcategory", "This category does not use a subcategory.");
  }

  return {
    document_type: documentType,
    document_number: documentNumber,
    document_date: documentDate.data,
    subject,
    persons_involved: personsInvolved,
    filing_year: filingYear,
    filing_subcategory: filingSubcategory,
  };
}

export async function validateAdminUploadForm(formData: FormData): Promise<ValidatedAdminUpload> {
  const idempotency = uuidSchema.safeParse(text(formData, "idempotency_key"));
  if (!idempotency.success) throw new UploadValidationError("idempotency_key", idempotency.error.issues[0].message);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new UploadValidationError("file", "Select a file to upload.");

  return {
    idempotencyKey: idempotency.data,
    metadata: validateMetadata(formData),
    file: await validateAdminUploadFile(file),
  };
}

export async function validateFolderUploadForm(formData: FormData): Promise<ValidatedFolderUpload> {
  const idempotency = uuidSchema.safeParse(text(formData, "idempotency_key"));
  if (!idempotency.success) throw new UploadValidationError("idempotency_key", idempotency.error.issues[0].message);
  const targetFolderId = z.string().uuid("A valid upload destination is required.").safeParse(text(formData, "target_folder_id"));
  if (!targetFolderId.success) throw new UploadValidationError("target_folder_id", targetFolderId.error.issues[0].message);
  const sourceRelativePath = submittedText(formData, "source_relative_path");
  let path: ReturnType<typeof validateCanonicalSourceRelativePath>;
  try { path = validateCanonicalSourceRelativePath(sourceRelativePath); }
  catch { throw new UploadValidationError("source_relative_path", "The source relative path is invalid."); }
  for (const field of ["normalized_relative_path_key", "drive_folder_id", "drive_parent_id", "drive_file_id", "logical_key", "department_key", "hierarchy_kind", "operation_token"]) {
    if (formData.has(field)) throw new UploadValidationError(field, "The folder upload request is invalid.");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) throw new UploadValidationError("file", "Select a file to upload.");
  const validatedFile = await validateAdminUploadFile(file);
  if (path.relativePath.split("/").at(-1) !== validatedFile.name) throw new UploadValidationError("source_relative_path", "The source relative path does not match the uploaded file.");
  return { idempotencyKey: idempotency.data, targetFolderId: targetFolderId.data, sourceRelativePath: path.relativePath, normalizedRelativePathKey: path.collisionKey, metadata: validateFolderMetadata(formData), file: validatedFile };
}
