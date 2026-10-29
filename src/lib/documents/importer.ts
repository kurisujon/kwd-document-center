import crypto from "node:crypto";
import { getDocumentTypeConfig, validateCustomMetadata } from "./document-types-config";
import type { AdminCategory } from "./admin-categories";

export interface ImporterFileItem {
  relativePath: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface ParsedImportRow {
  rowNumber: number;
  relativePath: string;
  documentType: AdminCategory;
  documentNumber: string;
  documentDate: string;
  subject: string;
  personsInvolved: string;
  customMetadata: Record<string, unknown>;
  fileSha256: string;
}

export interface ImportIssue {
  rowNumber: number;
  field?: string;
  message: string;
  kind: "ERROR" | "DUPLICATE_WARNING";
}

export interface DryRunReport {
  totalRows: number;
  matchedFiles: number;
  validRows: number;
  ready: boolean;
  issues: ImportIssue[];
  parsedRows: ParsedImportRow[];
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (char === "\r") {
        if (text[i + 1] === "\n") i += 1;
        field += "\n";
      } else {
        field += char;
      }
      continue;
    }
    if (afterQuote && char !== "," && char !== "\n" && char !== "\r") {
      throw new Error("CSV has invalid text after a quoted field.");
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\n") {
      finishRow();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      finishRow();
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  if (field || row.length || afterQuote) finishRow();
  return rows;
}

/**
 * Parses and dry-runs an import package consisting of a CSV metadata file
 * and a list of re-uploaded files. Checks schema constraints, file matching,
 * and duplicate detection.
 */
export function dryRunImport(
  csvContent: string,
  files: readonly ImporterFileItem[],
  existingRecords?: readonly { file_sha256?: string | null; document_number?: string | null; document_type?: string }[],
): DryRunReport {
  const issues: ImportIssue[] = [];
  const parsedRows: ParsedImportRow[] = [];

  const rawRecords = parseCsvRecords(csvContent);
  if (rawRecords.length === 0) {
    return {
      totalRows: 0,
      matchedFiles: 0,
      validRows: 0,
      ready: false,
      issues: [{ rowNumber: 1, message: "CSV file is empty.", kind: "ERROR" }],
      parsedRows: [],
    };
  }

  const headerRow = rawRecords[0]!.map((h) => h.trim().toLowerCase());
  const relativePathIdx = headerRow.indexOf("relative_path");
  const typeIdx = headerRow.indexOf("document_type");
  const numberIdx = headerRow.indexOf("document_number");
  const dateIdx = headerRow.indexOf("document_date");
  const subjectIdx = headerRow.indexOf("subject");
  const personsIdx = headerRow.indexOf("persons_involved");

  if (relativePathIdx === -1 || typeIdx === -1 || subjectIdx === -1 || dateIdx === -1) {
    return {
      totalRows: 0,
      matchedFiles: 0,
      validRows: 0,
      ready: false,
      issues: [
        {
          rowNumber: 1,
          message: "CSV header must include relative_path, document_type, document_date, and subject.",
          kind: "ERROR",
        },
      ],
      parsedRows: [],
    };
  }

  // Map files by relative path (normalized forward slashes and lowercased for match)
  const fileMap = new Map<string, ImporterFileItem>();
  for (const f of files) {
    fileMap.set(f.relativePath.replace(/\\/g, "/").toLowerCase(), f);
  }

  const existingHashes = new Set<string>();
  const existingNumbers = new Set<string>();
  if (existingRecords) {
    for (const r of existingRecords) {
      if (r.file_sha256) existingHashes.add(r.file_sha256.toLowerCase());
      if (r.document_number && r.document_type) {
        existingNumbers.add(`${r.document_type.toUpperCase()}::${r.document_number.toLowerCase()}`);
      }
    }
  }

  const seenInBatchHashes = new Set<string>();
  const seenInBatchNumbers = new Set<string>();

  for (let i = 1; i < rawRecords.length; i += 1) {
    const row = rawRecords[i]!;
    if (row.every((v) => v.trim() === "")) continue;

    const rowNum = i + 1;
    const relPath = (row[relativePathIdx] ?? "").trim();
    const docTypeRaw = (row[typeIdx] ?? "").trim().toUpperCase() as AdminCategory;
    const docNumber = numberIdx !== -1 ? (row[numberIdx] ?? "").trim() : "";
    const docDate = (row[dateIdx] ?? "").trim();
    const docSubject = (row[subjectIdx] ?? "").trim();
    const personsInvolved = personsIdx !== -1 ? (row[personsIdx] ?? "").trim() : "";

    let hasRowError = false;

    if (!relPath) {
      issues.push({ rowNumber: rowNum, field: "relative_path", message: "relative_path is required.", kind: "ERROR" });
      hasRowError = true;
    }

    const typeConfig = getDocumentTypeConfig(docTypeRaw);
    if (!typeConfig) {
      issues.push({ rowNumber: rowNum, field: "document_type", message: `Invalid document_type: "${docTypeRaw}".`, kind: "ERROR" });
      hasRowError = true;
    }

    if (!docSubject) {
      issues.push({ rowNumber: rowNum, field: "subject", message: "Subject is required.", kind: "ERROR" });
      hasRowError = true;
    }

    if (!docDate || !isValidIsoDate(docDate)) {
      issues.push({ rowNumber: rowNum, field: "document_date", message: "document_date must be a valid YYYY-MM-DD date.", kind: "ERROR" });
      hasRowError = true;
    }

    // Custom metadata extraction from meta_* columns
    const rawCustomMeta: Record<string, unknown> = {};
    for (let c = 0; c < headerRow.length; c += 1) {
      const colHeader = headerRow[c]!;
      if (colHeader.startsWith("meta_")) {
        const metaKey = colHeader.slice(5);
        const cellVal = (row[c] ?? "").trim();
        if (cellVal) {
          rawCustomMeta[metaKey] = cellVal;
        }
      }
    }

    let validatedCustomMeta: Record<string, unknown> = {};
    if (typeConfig) {
      const customValidation = validateCustomMetadata(docTypeRaw, rawCustomMeta);
      if (!customValidation.success) {
        issues.push({ rowNumber: rowNum, field: customValidation.field, message: customValidation.message, kind: "ERROR" });
        hasRowError = true;
      } else {
        validatedCustomMeta = customValidation.data;
      }
    }

    // Match file
    const matchedFile = fileMap.get(relPath.replace(/\\/g, "/").toLowerCase());
    let fileSha256 = "";
    if (!matchedFile) {
      issues.push({ rowNumber: rowNum, field: "relative_path", message: `File not found in upload package: "${relPath}".`, kind: "ERROR" });
      hasRowError = true;
    } else {
      fileSha256 = crypto.createHash("sha256").update(matchedFile.bytes).digest("hex");

      // Check duplicates
      if (existingHashes.has(fileSha256) || seenInBatchHashes.has(fileSha256)) {
        issues.push({
          rowNumber: rowNum,
          field: "file",
          message: `Identical file hash already exists in registry or batch: ${fileSha256.slice(0, 12)}...`,
          kind: "DUPLICATE_WARNING",
        });
      }
      seenInBatchHashes.add(fileSha256);
    }

    if (docNumber && docTypeRaw) {
      const numKey = `${docTypeRaw}::${docNumber.toLowerCase()}`;
      if (existingNumbers.has(numKey) || seenInBatchNumbers.has(numKey)) {
        issues.push({
          rowNumber: rowNum,
          field: "document_number",
          message: `Document number "${docNumber}" already exists for type "${docTypeRaw}".`,
          kind: "DUPLICATE_WARNING",
        });
      }
      seenInBatchNumbers.add(numKey);
    }

    if (!hasRowError && matchedFile) {
      parsedRows.push({
        rowNumber: rowNum,
        relativePath: relPath,
        documentType: docTypeRaw,
        documentNumber: docNumber,
        documentDate: docDate,
        subject: docSubject,
        personsInvolved,
        customMetadata: validatedCustomMeta,
        fileSha256,
      });
    }
  }

  const errorCount = issues.filter((i) => i.kind === "ERROR").length;
  return {
    totalRows: rawRecords.length - 1,
    matchedFiles: parsedRows.length,
    validRows: parsedRows.length,
    ready: errorCount === 0 && parsedRows.length > 0,
    issues,
    parsedRows,
  };
}
