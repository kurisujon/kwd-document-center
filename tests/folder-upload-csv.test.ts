import assert from "node:assert/strict";
import test from "node:test";
import {
  FolderUploadCsvError,
  buildFolderUploadCsvPreview,
  createFolderUploadCsvTemplate,
  folderUploadCsvHeader,
  folderUploadCsvMaxBytes,
  parseFolderUploadCsv,
  protectFolderUploadCsvValue,
  unprotectFolderUploadCsvValue,
} from "../src/lib/documents/folder-upload-csv.ts";

const encoder = new TextEncoder();
const header = folderUploadCsvHeader.join(",");
const csv = (rows: string, lineEnding = "\n") => encoder.encode(`${header}${lineEnding}${rows}`);
const item = (localId: string, sourceRelativePath: string, subject = "Existing subject") => ({ localId, sourceRelativePath, metadata: { document_number: "OLD-1", subject, document_date: "2027-01-01", persons_involved: "Existing person" } });

function expectCsvError(run: () => unknown, message: RegExp) {
  assert.throws(run, (value: unknown) => value instanceof FolderUploadCsvError && message.test(value.message));
}

test("Folder CSV parser accepts BOM, CRLF/LF, quoting, escaped quotes, and multiline fields", () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...csv('Reports/report.pdf,DOC-1,"Monthly, report","2027-02-03","KWD ""Admin"""\r\nNotes/memo.pdf,,"Line one\r\nLine two",,', "\r\n")]);
  const rows = parseFolderUploadCsv(bom);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { relative_path: "Reports/report.pdf", collisionKey: "reports/report.pdf", document_number: "DOC-1", subject: "Monthly, report", document_date: "2027-02-03", persons_involved: 'KWD "Admin"' });
  assert.equal(rows[1]!.subject, "Line one\nLine two");
});

test("Folder CSV parser rejects invalid encoding, malformed records, sizes, rows, and headers", () => {
  expectCsvError(() => parseFolderUploadCsv(new Uint8Array([0xff])), /UTF-8/);
  expectCsvError(() => parseFolderUploadCsv(csv('a.pdf,,"unterminated,,')), /unterminated/i);
  expectCsvError(() => parseFolderUploadCsv(csv('a.pdf,,subject,,extra,field')), /unexpected number/i);
  expectCsvError(() => parseFolderUploadCsv(csv('a.pdf,,,2027-02-29,')), /valid YYYY-MM-DD/);
  expectCsvError(() => parseFolderUploadCsv(encoder.encode("relative_path,subject,document_number,document_date,persons_involved\na.pdf,,,,")), /header must be exactly/i);
  expectCsvError(() => parseFolderUploadCsv(encoder.encode(`${header}\n${"a".repeat(folderUploadCsvMaxBytes)}`)), /256 KiB/);
  const tooMany = Array.from({ length: 26 }, (_, index) => `Folder/${index}.pdf,,,,`).join("\n");
  expectCsvError(() => parseFolderUploadCsv(csv(tooMany)), /more than 25/i);
});

test("Folder CSV parser canonicalizes paths and rejects duplicates and collisions", () => {
  const rows = parseFolderUploadCsv(csv("January/report.pdf,,,2027-01-02,\nFebruary/report.pdf,,,,\n\n"));
  assert.deepEqual(rows.map((row) => row.relative_path), ["January/report.pdf", "February/report.pdf"]);
  expectCsvError(() => parseFolderUploadCsv(csv("January/report.pdf,,,,\njanuary/report.pdf,,, ,")), /duplicates a relative path/i);
  expectCsvError(() => parseFolderUploadCsv(csv("caf\u00e9.pdf,,,,\ncafe\u0301.pdf,,, ,")), /duplicates a relative path/i);
  expectCsvError(() => parseFolderUploadCsv(csv("../report.pdf,,,,")), /invalid relative path/i);
});

test("Folder CSV preview matches complete canonical paths and remains atomic on unmatched paths", () => {
  const rows = parseFolderUploadCsv(csv("January/report.pdf,NEW-1,January report,2027-02-03,\nFebruary/report.pdf,,February report,,New person"));
  const preview = buildFolderUploadCsvPreview(rows, [item("jan", "January/report.pdf"), item("feb", "February/report.pdf")]);
  assert.equal(preview.matchedFiles, 2);
  assert.equal(preview.selectedFilesWithoutRows.length, 0);
  assert.equal(preview.updates[0]!.values.subject, "January report");
  assert.equal(preview.updates[1]!.values.document_number, undefined, "blank CSV cells preserve existing values");
  expectCsvError(() => buildFolderUploadCsvPreview(parseFolderUploadCsv(csv("Missing/report.pdf,,,,")), [item("jan", "January/report.pdf")]), /does not match a selected file/i);
});

test("Folder CSV template has the approved header and formula-safe reversible values", () => {
  const template = createFolderUploadCsvTemplate([item("formula", "=formula.pdf", "  =SUM(A1:A2)")]);
  assert.ok(template.startsWith(`\uFEFF${header}\r\n`));
  assert.match(template, /'=formula\.pdf/);
  assert.match(template, /'  =SUM\(A1:A2\)/);
  const parsed = parseFolderUploadCsv(encoder.encode(template));
  assert.equal(parsed[0]!.relative_path, "=formula.pdf");
  assert.equal(parsed[0]!.subject, "=SUM(A1:A2)");
  assert.doesNotMatch(template, /drive_file_id|operation_token|content_sha256|collisionKey/i);
});

test("Folder CSV apostrophe convention reverses exported formula and literal-apostrophe values", () => {
  const values = ["=SUM(A1:A2)", "'=SUM(A1:A2)", "''=SUM(A1:A2)", "+123", "-123", "@formula", "  =SUM(A1:A2)", "'ordinary", "''ordinary", "Mëmo"];
  for (const value of values) {
    const encoded = protectFolderUploadCsvValue(value);
    assert.equal(unprotectFolderUploadCsvValue(encoded), value, value);
    if (/^'*\s*[=+\-@]/.test(value)) assert.ok(encoded.startsWith("'"), value);
  }
  const paths = ["=formula.pdf", "'=literal.pdf", "''=another.pdf"];
  for (const path of paths) {
    const template = createFolderUploadCsvTemplate([item("path", path, "Safe subject")]);
    assert.equal(parseFolderUploadCsv(encoder.encode(template))[0]!.relative_path, path);
  }
  const duplicate = `${header}\n'=formula.pdf,,,,\n=formula.pdf,,,,`;
  expectCsvError(() => parseFolderUploadCsv(encoder.encode(duplicate)), /duplicates a relative path/i);
});

test("Folder CSV parser retains its byte limit at the exact boundary", () => {
  const valid = encoder.encode(`${header}\nreport.pdf,,,2027-01-01,`);
  const exact = new Uint8Array(folderUploadCsvMaxBytes);
  exact.set(valid);
  exact.fill(0x20, valid.byteLength);
  assert.equal(parseFolderUploadCsv(exact)[0]!.relative_path, "report.pdf");
  expectCsvError(() => parseFolderUploadCsv(new Uint8Array(folderUploadCsvMaxBytes + 1)), /256 KiB/);
});
