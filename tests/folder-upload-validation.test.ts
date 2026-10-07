import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeFolderRelativePath, folderUploadLimits, parseFolderSelection, type FolderSelectionEntry } from "../src/lib/documents/folder-upload-validation.ts";

const MiB = 1024 * 1024;
const entry = (webkitRelativePath: string, overrides: Partial<FolderSelectionEntry> = {}): FolderSelectionEntry => {
  const name = webkitRelativePath.replace(/\\/g, "/").split("/").at(-1) ?? "file.pdf";
  return { name, size: 1, type: "application/pdf", webkitRelativePath, ...overrides };
};

function pathValue(path: string) {
  const result = canonicalizeFolderRelativePath(path);
  assert.ok("value" in result);
  return result.value;
}

function pathIssue(path: string) {
  const result = canonicalizeFolderRelativePath(path);
  assert.ok("issue" in result);
  return result.issue.code;
}

test("canonicalizes one selected root exactly once using NFC slash-separated provenance", () => {
  assert.equal(pathValue("Root/file.pdf").relativePath, "file.pdf");
  assert.equal(pathValue("Root/A/file.pdf").relativePath, "A/file.pdf");
  assert.equal(pathValue("Root/A/B/C/file.pdf").relativePath, "A/B/C/file.pdf");
  assert.equal(pathValue("Root/Cafe\u0301.pdf").relativePath, "Café.pdf");
  assert.equal(pathValue("Root/A\\file.pdf").relativePath, "A/file.pdf");
});

test("rejects absolute, traversal, empty, control-character, and invalid root paths", () => {
  for (const path of ["/absolute/file.pdf", "C:/file.pdf", "C:\\file.pdf", "\\\\server\\share\\file.pdf", "file://host/file.pdf"]) assert.equal(pathIssue(path), "ABSOLUTE_PATH");
  for (const path of ["Root/./file.pdf", "Root/../file.pdf", "Root/A/..\\file.pdf"]) assert.equal(pathIssue(path), "PATH_TRAVERSAL");
  assert.equal(pathIssue("Root//file.pdf"), "INVALID_PATH");
  assert.equal(pathIssue("Root/\u0000file.pdf"), "CONTROL_CHARACTER");
  assert.equal(pathIssue("Root/\u001ffile.pdf"), "CONTROL_CHARACTER");
  assert.equal(pathIssue("Root/\u007ffile.pdf"), "CONTROL_CHARACTER");
  assert.equal(pathIssue("file.pdf"), "INVALID_PATH");
});

test("uses UTF-8 byte limits and exact directory-depth boundaries", () => {
  assert.equal(pathIssue(`Root/${"é".repeat(121)}.pdf`), "SEGMENT_TOO_LONG");
  const longButIndividualSegments = Array.from({ length: 8 }, () => "a".repeat(127)).join("/");
  assert.equal(pathIssue(`Root/${longButIndividualSegments}/x.pdf`), "PATH_TOO_LONG");
  assert.equal(pathValue(`Root/${Array.from({ length: 8 }, (_, index) => `D${index}`).join("/")}/file.pdf`).relativePath.startsWith("D0/"), true);
  assert.equal(pathIssue(`Root/${Array.from({ length: 9 }, (_, index) => `D${index}`).join("/")}/file.pdf`), "PATH_TOO_DEEP");
  assert.equal(pathValue("Root/file.pdf").directories.length, 0);
});

test("creates valid manifests and preserves same names in distinct local directories", () => {
  const one = parseFolderSelection([entry("Root/file.pdf")]);
  assert.equal(one.isValid, true);
  assert.equal(one.rootName, "Root");
  assert.equal(one.files[0]?.relativePath, "file.pdf");
  const multiple = parseFolderSelection([entry("Root/January/report.pdf"), entry("Root/February/report.pdf")]);
  assert.equal(multiple.isValid, true);
  assert.equal(multiple.uniqueDirectoryCount, 2);
  assert.deepEqual(multiple.files.map((file) => file.relativePath), ["January/report.pdf", "February/report.pdf"]);
});

test("returns safe manifest issues for empty selections, mixed roots, unsupported files, and size limits", () => {
  const empty = parseFolderSelection([]);
  assert.equal(empty.isValid, false);
  assert.deepEqual(empty.issues, [{ code: "NO_FILES_SELECTED" }]);
  const mixed = parseFolderSelection([entry("RootA/a.pdf"), entry("RootB/b.pdf")]);
  assert.equal(mixed.isValid, false);
  assert.ok(mixed.issues.some((value) => value.code === "MIXED_ROOTS"));
  const unsupported = parseFolderSelection([entry("Root/good.pdf"), entry("Root/bad.exe", { type: "application/x-msdownload" })]);
  assert.equal(unsupported.files[1]?.issues.some((value) => value.code === "UNSUPPORTED_TYPE"), true);
  assert.equal(unsupported.totalFiles, 2);
  assert.equal(unsupported.isValid, false);
  const atLimit = parseFolderSelection([entry("Root/four.pdf", { size: folderUploadLimits.maxFileBytes })]);
  assert.equal(atLimit.isValid, true);
  const overLimit = parseFolderSelection([entry("Root/over.pdf", { size: folderUploadLimits.maxFileBytes + 1 })]);
  assert.equal(overLimit.files[0]?.issues.some((value) => value.code === "FILE_TOO_LARGE"), true);
});

test("enforces manifest file and total byte limits without allocating file buffers", () => {
  const exactly25 = Array.from({ length: 25 }, (_, index) => entry(`Root/f${index}.pdf`));
  assert.equal(parseFolderSelection(exactly25).isValid, true);
  const twentySix = Array.from({ length: 26 }, (_, index) => entry(`Root/f${index}.pdf`));
  assert.ok(parseFolderSelection(twentySix).issues.some((value) => value.code === "TOO_MANY_FILES"));
  const exact64MiB = Array.from({ length: 16 }, (_, index) => entry(`Root/f${index}.pdf`, { size: 4 * MiB }));
  assert.equal(parseFolderSelection(exact64MiB).isValid, true);
  const over64MiB = Array.from({ length: 17 }, (_, index) => entry(`Root/f${index}.pdf`, { size: 4 * MiB }));
  assert.ok(parseFolderSelection(over64MiB).issues.some((value) => value.code === "TOTAL_SIZE_EXCEEDED"));
});

test("rejects exact, case-normalized, and NFC-normalized path collisions", () => {
  for (const paths of [["Root/A.pdf", "Root/A.pdf"], ["Root/A.pdf", "Root/a.pdf"], ["Root/Café.pdf", "Root/Cafe\u0301.pdf"]]) {
    const manifest = parseFolderSelection(paths.map((path) => entry(path)));
    assert.equal(manifest.isValid, false);
    assert.equal(manifest.files.every((file) => file.issues.some((value) => value.code === "DUPLICATE_PATH")), true);
  }
});

test("calculates unique canonical directories and enforces the directory limit", () => {
  const tree = parseFolderSelection([entry("Root/A/x.pdf"), entry("Root/A/y.pdf"), entry("Root/A/B/z.pdf")]);
  assert.equal(tree.uniqueDirectoryCount, 2);
  const manyDirectories = Array.from({ length: 13 }, (_, index) => entry(`Root/${Array.from({ length: 8 }, (_, depth) => `d${index}-${depth}`).join("/")}/f${index}.pdf`));
  const manifest = parseFolderSelection(manyDirectories);
  assert.equal(manifest.uniqueDirectoryCount, 104);
  assert.ok(manifest.issues.some((value) => value.code === "TOO_MANY_DIRECTORIES"));
});

test("uses the existing upload-format allowlist without mutating source entries or making external calls", () => {
  const inputs = [entry("Root/valid.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), entry("Root/unsupported.zip", { type: "application/zip" })];
  const before = structuredClone(inputs);
  const first = parseFolderSelection(inputs);
  const second = parseFolderSelection(inputs);
  assert.equal(first.files[0]?.issues.length, 0);
  assert.equal(first.files[1]?.issues.some((value) => value.code === "UNSUPPORTED_TYPE"), true);
  assert.deepEqual(inputs, before);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("drive"), false);
  assert.equal(JSON.stringify(first).includes("destination"), false);
});
