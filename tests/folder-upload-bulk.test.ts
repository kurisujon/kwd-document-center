import assert from "node:assert/strict";
import test from "node:test";
import { createFolderUploadResultsCsv, folderUploadResultsCsvHeader } from "../src/lib/documents/folder-upload-csv.ts";
import { isFolderBulkEditable, isValidFolderBulkDate, selectedFolderBulkIds, validateFolderBulkValues } from "../src/lib/documents/folder-upload-bulk.ts";
import { toFolderUploadResultsCsvRow } from "../src/lib/documents/folder-upload-results.ts";

const metadata = { document_number: "DOC-1", subject: "Subject", document_date: "2027-01-02", persons_involved: "KWD" };
const item = (localId: string, status: "READY" | "NEEDS_METADATA" | "INVALID_FILE" | "UPLOADED" = "READY", attempted = false) => ({ localId, status, attempted, metadata });

test("Folder bulk editing selects only editable pre-attempt rows and validates atomic field changes", () => {
  assert.equal(isFolderBulkEditable(item("ready")), true);
  assert.equal(isFolderBulkEditable(item("needs", "NEEDS_METADATA")), true);
  assert.equal(isFolderBulkEditable(item("invalid", "INVALID_FILE")), false);
  assert.equal(isFolderBulkEditable(item("uploaded", "UPLOADED")), false);
  assert.equal(isFolderBulkEditable(item("done", "UPLOADED", true)), false);
  assert.deepEqual([...selectedFolderBulkIds([item("ready"), item("invalid", "INVALID_FILE"), item("done", "UPLOADED", true)], new Set(["ready", "invalid", "done"]))], ["ready"]);
  assert.equal(validateFolderBulkValues(new Set(["subject"]), { subject: "", document_date: "", persons_involved: "" }, "APPLY"), "Subject is required and must not exceed 500 characters.");
  assert.equal(validateFolderBulkValues(new Set(["document_date"]), { subject: "", document_date: "2027-02-29", persons_involved: "" }, "APPLY"), "Document date must use a valid YYYY-MM-DD value.");
  assert.equal(validateFolderBulkValues(new Set(["persons_involved"]), { subject: "", document_date: "", persons_involved: "Office" }, "APPLY"), undefined);
  assert.equal(validateFolderBulkValues(new Set(["subject"]), { subject: "", document_date: "", persons_involved: "" }, "CLEAR"), undefined);
  assert.equal(isValidFolderBulkDate("2028-02-29"), true);
  assert.equal(isValidFolderBulkDate("2027-02-29"), false);
});

test("Folder results CSV has safe deterministic columns, status mappings, and formula protection", () => {
  const rows = [
    toFolderUploadResultsCsvRow({ sourceRelativePath: "A/one.pdf", fileName: "one.pdf", status: "UPLOADED", metadata }),
    toFolderUploadResultsCsvRow({ sourceRelativePath: "B/two.pdf", fileName: "two.pdf", status: "FAILED", retryDisposition: "RETRYABLE", metadata: { ...metadata, subject: "=formula" } }),
    toFolderUploadResultsCsvRow({ sourceRelativePath: "C/three.pdf", fileName: "three.pdf", status: "FAILED", retryDisposition: "BLOCKED", metadata }),
    toFolderUploadResultsCsvRow({ sourceRelativePath: "D/four.pdf", fileName: "four.pdf", status: "IN_PROGRESS", metadata }),
    toFolderUploadResultsCsvRow({ sourceRelativePath: "E/five.pdf", fileName: "five.pdf", status: "INVALID_FILE", metadata }),
  ];
  assert.deepEqual(rows.map((row) => row.safe_error_code), ["", "RETRY_AVAILABLE", "CONFLICT", "UPLOAD_STILL_PROCESSING", "INVALID_FILE"]);
  const report = createFolderUploadResultsCsv(rows);
  assert.ok(report.startsWith(`\uFEFF${folderUploadResultsCsvHeader.join(",")}\r\n`));
  assert.match(report, /'=formula/);
  assert.ok(report.indexOf("A/one.pdf") < report.indexOf("B/two.pdf"));
  assert.doesNotMatch(report, /drive_file_id|drive_folder_id|operation_token|content_sha256|collisionKey|document_id/i);
});
