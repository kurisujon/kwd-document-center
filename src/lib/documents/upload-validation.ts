import { z } from "zod";
import { adminSubcategories, categoryUsesYear, isAdminCategory } from "./admin-categories";
import type { AdminDocumentMetadata, ValidatedAdminUpload } from "./upload-types";

export const defaultAdminUploadMaxBytes = 4 * 1024 * 1024;

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

function maxUploadBytes(): number {
  const configured = process.env.ADMIN_UPLOAD_MAX_BYTES;
  if (!configured) return defaultAdminUploadMaxBytes;
  if (!/^\d+$/.test(configured) || Number(configured) < 1) {
    throw new Error("ADMIN_UPLOAD_MAX_BYTES must be a positive integer.");
  }
  return Number(configured);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function includesAscii(bytes: Uint8Array, value: string): boolean {
  const expected = new TextEncoder().encode(value);
  return bytes.some((_, start) => expected.every((byte, offset) => bytes[start + offset] === byte));
}

const formats = {
  ".pdf": { mimeType: "application/pdf", signatures: [[0x25, 0x50, 0x44, 0x46]] },
  ".jpg": { mimeType: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]] },
  ".jpeg": { mimeType: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]] },
  ".png": { mimeType: "image/png", signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  ".docx": { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signatures: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]] },
  ".xlsx": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signatures: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]] },
  ".doc": { mimeType: "application/msword", signatures: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] },
  ".xls": { mimeType: "application/vnd.ms-excel", signatures: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] },
} as const;

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

async function validateFile(file: File) {
  const name = validateFileName(file.name);
  if (file.size < 1) throw new UploadValidationError("file", "Select a non-empty file.");
  if (file.size > maxUploadBytes()) {
    throw new UploadValidationError("file", `The file must not exceed ${Math.floor(maxUploadBytes() / 1024 / 1024)} MiB.`);
  }

  const extension = name.slice(name.lastIndexOf(".")).toLowerCase() as keyof typeof formats;
  const format = formats[extension];
  if (!format) throw new UploadValidationError("file", "This file type is not supported.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!format.signatures.some((signature) => startsWith(bytes, [...signature]))) {
    throw new UploadValidationError("file", "The selected file does not match its file type.");
  }
  if (extension === ".docx" && !includesAscii(bytes, "word/document.xml")) {
    throw new UploadValidationError("file", "The selected file is not a valid Word document.");
  }
  if (extension === ".xlsx" && !includesAscii(bytes, "xl/workbook.xml")) {
    throw new UploadValidationError("file", "The selected file is not a valid Excel workbook.");
  }
  if (file.type && file.type !== "application/octet-stream" && file.type !== format.mimeType) {
    throw new UploadValidationError("file", "The selected file has inconsistent type information.");
  }
  return { name, mimeType: format.mimeType, size: file.size, bytes };
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
    file: await validateFile(file),
  };
}
