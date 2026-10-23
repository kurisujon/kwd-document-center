import { validateCanonicalSourceRelativePath } from "./folder-upload-validation";

export const folderUploadCsvHeader = ["relative_path", "document_number", "subject", "document_date", "persons_involved"] as const;
export const folderUploadResultsCsvHeader = ["relative_path", "filename", "document_number", "subject", "document_date", "persons_involved", "status", "safe_error_code", "safe_error_message"] as const;
export const folderUploadCsvMaxBytes = 256 * 1024;
export const folderUploadCsvMaxRows = 25;

export type FolderUploadCsvMetadata = {
  document_number: string;
  subject: string;
  document_date: string;
  persons_involved: string;
};

export type FolderUploadCsvRow = FolderUploadCsvMetadata & {
  relative_path: string;
  collisionKey: string;
};

export type FolderUploadCsvItem = {
  localId: string;
  sourceRelativePath: string;
  metadata: FolderUploadCsvMetadata;
};

export type FolderUploadCsvChange = {
  field: Exclude<keyof FolderUploadCsvMetadata, "relative_path">;
  currentValue: string;
  importedValue: string;
};

export type FolderUploadCsvPreview = {
  rowsParsed: number;
  matchedFiles: number;
  selectedFilesWithoutRows: string[];
  updates: Array<{ localId: string; relativePath: string; values: Partial<FolderUploadCsvMetadata>; changes: FolderUploadCsvChange[] }>;
};

export class FolderUploadCsvError extends Error {}

function error(message: string): never { throw new FolderUploadCsvError(message); }
function isBlankRow(row: readonly string[]) { return row.every((value) => value === ""); }
function isFormulaValue(value: string) { return /^\s*[=+\-@]/.test(value); }
function leadingApostrophes(value: string) { return value.match(/^'+/)?.[0].length ?? 0; }

/**
 * Spreadsheet-safe CSV convention: original leading apostrophes are doubled;
 * a single extra apostrophe protects a formula-like remainder. The importer
 * reverses this exact representation before relative-path validation.
 * Manually authored literal apostrophes use the same doubling convention.
 */
export function protectFolderUploadCsvValue(value: string): string {
  const apostrophes = leadingApostrophes(value);
  const remainder = value.slice(apostrophes);
  const escapedApostrophes = "'".repeat(apostrophes * 2);
  if (isFormulaValue(remainder)) return `'${escapedApostrophes}${remainder}`;
  return apostrophes ? `${escapedApostrophes}${remainder}` : value;
}

export function unprotectFolderUploadCsvValue(value: string): string {
  const apostrophes = leadingApostrophes(value);
  const remainder = value.slice(apostrophes);
  if (apostrophes % 2 === 1 && isFormulaValue(remainder)) return `${"'".repeat((apostrophes - 1) / 2)}${remainder}`;
  if (apostrophes > 0 && apostrophes % 2 === 0) return `${"'".repeat(apostrophes / 2)}${remainder}`;
  return value;
}

export function quoteFolderUploadCsvValue(value: string): string {
  const safe = protectFolderUploadCsvValue(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function createFolderUploadCsvTemplate(items: readonly Pick<FolderUploadCsvItem, "sourceRelativePath" | "metadata">[]): string {
  const rows = items.map((item) => [
    item.sourceRelativePath,
    item.metadata.document_number,
    item.metadata.subject,
    item.metadata.document_date,
    item.metadata.persons_involved,
  ].map(quoteFolderUploadCsvValue).join(","));
  return `\uFEFF${folderUploadCsvHeader.join(",")}\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}`;
}

export type FolderUploadResultsCsvRow = {
  relative_path: string;
  filename: string;
  document_number: string;
  subject: string;
  document_date: string;
  persons_involved: string;
  status: string;
  safe_error_code: string;
  safe_error_message: string;
};

/** Safe client-side snapshot only; callers supply no internal identifiers. */
export function createFolderUploadResultsCsv(rows: readonly FolderUploadResultsCsvRow[]): string {
  const lines = rows.map((row) => folderUploadResultsCsvHeader.map((field) => quoteFolderUploadCsvValue(row[field])).join(","));
  return `\uFEFF${folderUploadResultsCsvHeader.join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
}

function parseRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  const finishField = () => { row.push(field); field = ""; afterQuote = false; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; afterQuote = true; }
      } else if (character === "\r") {
        if (text[index + 1] !== "\n") error("CSV contains an invalid line ending.");
        field += "\n";
        index += 1;
      } else field += character;
      continue;
    }
    if (afterQuote && character !== "," && character !== "\n" && character !== "\r") error("CSV has text after a quoted field.");
    if (character === '"') {
      if (field || afterQuote) error("CSV has an invalid quoted field.");
      quoted = true;
    } else if (character === ",") finishField();
    else if (character === "\n") finishRow();
    else if (character === "\r") {
      if (text[index + 1] !== "\n") error("CSV contains an invalid line ending.");
      finishRow();
      index += 1;
    } else field += character;
  }
  if (quoted) error("CSV has an unterminated quoted field.");
  if (field || row.length || afterQuote) finishRow();
  return rows;
}

function normalizedMetadata(value: string, field: keyof FolderUploadCsvMetadata): string {
  const normalized = unprotectFolderUploadCsvValue(value).trim();
  const maximum = field === "document_number" ? 150 : 500;
  if (normalized.length > maximum) error(`${field === "document_number" ? "Document number" : field === "persons_involved" ? "Persons involved" : "Subject"} exceeds the allowed length.`);
  if (field === "document_date" && normalized && !isValidDate(normalized)) error("Document date must use a valid YYYY-MM-DD value.");
  return normalized;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseFolderUploadCsv(bytes: Uint8Array): FolderUploadCsvRow[] {
  if (bytes.byteLength > folderUploadCsvMaxBytes) error("CSV exceeds the 256 KiB limit.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { error("CSV must use UTF-8 encoding."); }
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  const records = parseRecords(text);
  while (records.length > 1 && isBlankRow(records.at(-1)!)) records.pop();
  const header = records.shift();
  if (!header || header.length !== folderUploadCsvHeader.length || header.some((value, index) => value !== folderUploadCsvHeader[index])) {
    error(`CSV header must be exactly: ${folderUploadCsvHeader.join(",")}`);
  }
  if (records.length > folderUploadCsvMaxRows) error("CSV contains more than 25 data rows.");
  const seenPaths = new Set<string>();
  return records.map((record, index) => {
    if (record.length !== folderUploadCsvHeader.length) error(`CSV row ${index + 2} has an unexpected number of fields.`);
    if (isBlankRow(record)) error(`CSV row ${index + 2} is blank.`);
    const rawPath = unprotectFolderUploadCsvValue(record[0]!);
    let path: ReturnType<typeof validateCanonicalSourceRelativePath>;
    try { path = validateCanonicalSourceRelativePath(rawPath); }
    catch { error(`CSV row ${index + 2} has an invalid relative path.`); }
    if (seenPaths.has(path.collisionKey)) error(`CSV row ${index + 2} duplicates a relative path.`);
    seenPaths.add(path.collisionKey);
    return {
      relative_path: path.relativePath,
      collisionKey: path.collisionKey,
      document_number: normalizedMetadata(record[1]!, "document_number"),
      subject: normalizedMetadata(record[2]!, "subject"),
      document_date: normalizedMetadata(record[3]!, "document_date"),
      persons_involved: normalizedMetadata(record[4]!, "persons_involved"),
    };
  });
}

export function buildFolderUploadCsvPreview(rows: readonly FolderUploadCsvRow[], items: readonly FolderUploadCsvItem[]): FolderUploadCsvPreview {
  const itemsByPath = new Map<string, FolderUploadCsvItem>();
  for (const item of items) {
    let path: ReturnType<typeof validateCanonicalSourceRelativePath>;
    try { path = validateCanonicalSourceRelativePath(item.sourceRelativePath); }
    catch { error("The current folder selection has an invalid relative path."); }
    if (itemsByPath.has(path.collisionKey)) error("The current folder selection has ambiguous relative paths.");
    itemsByPath.set(path.collisionKey, item);
  }
  const matchedIds = new Set<string>();
  const updates = rows.map((row) => {
    const item = itemsByPath.get(row.collisionKey);
    if (!item || item.sourceRelativePath !== row.relative_path) error(`CSV path does not match a selected file: ${row.relative_path}`);
    matchedIds.add(item.localId);
    const values: Partial<FolderUploadCsvMetadata> = {};
    const changes: FolderUploadCsvChange[] = [];
    for (const field of ["document_number", "subject", "document_date", "persons_involved"] as const) {
      if (!row[field]) continue;
      values[field] = row[field];
      if (item.metadata[field] !== row[field]) changes.push({ field, currentValue: item.metadata[field], importedValue: row[field] });
    }
    return { localId: item.localId, relativePath: item.sourceRelativePath, values, changes };
  });
  return {
    rowsParsed: rows.length,
    matchedFiles: updates.length,
    selectedFilesWithoutRows: items.filter((item) => !matchedIds.has(item.localId)).map((item) => item.sourceRelativePath),
    updates,
  };
}
