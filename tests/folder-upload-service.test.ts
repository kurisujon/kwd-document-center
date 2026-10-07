import assert from "node:assert/strict";
import test from "node:test";
import { createUploadDocumentHandler } from "../src/lib/documents/file-api.ts";
import { uploadFolderDocument, DocumentUploadError } from "../src/lib/documents/upload-service.ts";
import { validateFolderUploadForm } from "../src/lib/documents/upload-validation.ts";
import type { HierarchyFolderRecord } from "../src/lib/documents/hierarchy-repository.ts";

const staff = { id: "11111111-1111-4111-8111-111111111111", email: "staff@example.test", name: "Staff", role: "STAFF" as const, status: "ACTIVE" as const };
const folder = (overrides: Partial<HierarchyFolderRecord> = {}): HierarchyFolderRecord => ({
  id: "22222222-2222-4222-8222-222222222222", idempotencyKey: "key", logicalParentKey: "ADMIN|2027", parentFolderId: "parent", departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: 2027, category: "BACTI TEST", subcategory: null, logicalKey: "ADMIN|2027|BACTI TEST", name: "BACTI TEST", normalizedName: "bacti test", source: "DYNAMIC", status: "ACTIVE", driveParentId: "internal-parent", driveFolderId: "internal-destination", uploadEnabled: true, operationToken: null, leaseExpiresAt: null, createdBy: staff.id, errorCategory: null, createdAt: "2026-10-06", updatedAt: "2026-10-06", ...overrides,
});

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ idempotency_key: "33333333-3333-4333-8333-333333333333", document_date: "2027-01-01", subject: "Folder report", document_number: "", persons_involved: "", target_folder_id: folder().id, source_relative_path: "Reports/January/report.pdf", ...fields })) data.set(key, value);
  data.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", { type: "application/pdf" }));
  return data;
}

const document = { document_id: "document", document_type: "BACTI TEST", document_number: null, document_date: "2027-01-01", subject: "Folder report", persons_involved: null, drive_file_id: "internal-file", drive_url: null, file_name: "report.pdf", file_type: "application/pdf", filing_year: 2027, filing_subcategory: null, status: "ACTIVE" as const, created_by: staff.email, created_at: "2026-10-06", updated_at: "2026-10-06" };

function attempts(status: "PENDING_UPLOAD" | "UPLOADING" | "PENDING_REGISTRY" | "FAILED" | "COMPLETE" = "PENDING_UPLOAD") {
  const attempt = { id: "attempt", idempotency_key: "33333333-3333-4333-8333-333333333333", status, drive_file_id: status === "PENDING_UPLOAD" ? null : "internal-file", operation_token: null, reservation_expires_at: null, metadata_snapshot: {}, document_id: status === "COMPLETE" ? "document" : null, created_by: staff.id, safe_error_code: null };
  return {
    async findByIdempotencyKey() { return attempt; },
    async claimDriveIdReservation() { return { claimed: true, operationToken: "token" }; },
    async clearDriveIdReservation() {},
    async persistDriveFileId() { return true; },
    async resumeUpload() { return { resumed: true, operationToken: "token" }; },
    async recoverInterruptedUploadToFailed() { return { changed: false, attempt }; },
    async markPendingRegistry() { return true; },
    async markFailed() { return { changed: true, attempt }; },
    async finalize() { return document; },
    async getDocument() { return document; },
  };
}

test("folder form validates an already-relative server path and rejects partial or privileged fields", async () => {
  const upload = await validateFolderUploadForm(form());
  assert.equal(upload.sourceRelativePath, "Reports/January/report.pdf");
  assert.equal(upload.normalizedRelativePathKey, "reports/january/report.pdf");
  assert.equal((await validateFolderUploadForm(form({ source_relative_path: "Reports /report.pdf" }))).sourceRelativePath, "Reports /report.pdf");
  for (const fields of [{ source_relative_path: "../report.pdf" }, { source_relative_path: "/report.pdf" }, { source_relative_path: "Reports/\u0000report.pdf" }, { source_relative_path: "Reports/invoice.pdf" }, { source_relative_path: "   " }, { normalized_relative_path_key: "browser-chosen" }]) await assert.rejects(() => validateFolderUploadForm(form(fields)));
});

test("folder service claims with server-derived metadata, actual bytes hash, and exact registered Drive target", async () => {
  const upload = await validateFolderUploadForm(form({ document_type: "CONTRACTS", filing_year: "1999", filing_subcategory: "client" }));
  let claimInput: Record<string, unknown> | null = null;
  let providerInput: Record<string, unknown> | null = null;
  let finalized = 0;
  const result = await uploadFolderDocument({
    upload, user: staff, getDestination: async () => folder(), attempts: attempts() as never,
    folderAttempts: {
      async claimFolderUploadAttempt(input) { claimInput = input as unknown as Record<string, unknown>; return { outcome: "CLAIMED", attemptId: "attempt", attemptStatus: "PENDING_UPLOAD", driveFileId: null, operationToken: null, reservationExpiresAt: null, documentId: null }; },
      async finalizeFolderUploadAttempt() { finalized += 1; return document; },
    },
    drive: { async generateFileId() { return "internal-file"; }, async upload(input) { providerInput = input as unknown as Record<string, unknown>; return { id: "internal-file", name: "report.pdf", mimeType: "application/pdf", trashed: false, webViewLink: "" }; }, async getMetadata() { throw new Error("not called"); }, async download() { throw new Error("not called"); } },
  });
  assert.equal(result.created, true);
  assert.equal(finalized, 1);
  assert.equal((claimInput?.metadataSnapshot as { document_type: string }).document_type, "BACTI TEST");
  assert.equal((claimInput?.metadataSnapshot as { filing_year: number }).filing_year, 2027);
  assert.equal((claimInput?.metadataSnapshot as { filing_subcategory: string }).filing_subcategory, "");
  assert.equal((claimInput?.contentSha256 as Uint8Array).byteLength, 32);
  assert.equal(providerInput?.folderId, "internal-destination");
  assert.equal(providerInput?.name, "report.pdf");
});

test("folder replay completes without provider work and claim outcomes stay safe", async () => {
  const upload = await validateFolderUploadForm(form());
  let uploads = 0;
  let finalized = 0;
  const pending = await uploadFolderDocument({
    upload, user: staff, getDestination: async () => folder({ uploadEnabled: false, status: "FAILED" }), attempts: attempts("PENDING_REGISTRY") as never,
    folderAttempts: { async claimFolderUploadAttempt() { return { outcome: "REPLAY", attemptId: "attempt", attemptStatus: "PENDING_REGISTRY", driveFileId: "internal-file", operationToken: null, reservationExpiresAt: null, documentId: null }; }, async finalizeFolderUploadAttempt() { finalized += 1; return document; } },
    drive: { async generateFileId() { throw new Error("not called"); }, async upload() { uploads += 1; throw new Error("not called"); }, async getMetadata() { throw new Error("not called"); }, async download() { throw new Error("not called"); } },
  });
  assert.equal(pending.created, false);
  assert.equal(finalized, 1);
  assert.equal(uploads, 0);
  for (const [outcome, status] of [["DUPLICATE_PATH", 409], ["IDEMPOTENCY_MISMATCH", 409], ["INVALID_DESTINATION", 400], ["INVALID_REQUEST", 400]] as const) {
    await assert.rejects(() => uploadFolderDocument({ upload, user: staff, getDestination: async () => folder(), attempts: attempts() as never, folderAttempts: { async claimFolderUploadAttempt() { return { outcome, attemptId: null, attemptStatus: null, driveFileId: null, operationToken: null, reservationExpiresAt: null, documentId: null }; }, async finalizeFolderUploadAttempt() { return document; } }, drive: {} as never }), (error: unknown) => error instanceof DocumentUploadError && error.status === status);
  }
});

test("folder attempts preserve hashes, resume FAILED with the same Drive ID, and bypass provider work for COMPLETE", async () => {
  const upload = await validateFolderUploadForm(form());
  const hashes: Uint8Array[] = [];
  let generated = 0;
  const failedResult = await uploadFolderDocument({
    upload, user: staff, getDestination: async () => folder(), attempts: attempts("FAILED") as never,
    folderAttempts: { async claimFolderUploadAttempt(input) { hashes.push(input.contentSha256); return { outcome: "REPLAY", attemptId: "attempt", attemptStatus: "FAILED", driveFileId: "internal-file", operationToken: null, reservationExpiresAt: null, documentId: null }; }, async finalizeFolderUploadAttempt() { return document; } },
    drive: { async generateFileId() { generated += 1; return "replacement"; }, async upload(input) { assert.equal(input.fileId, "internal-file"); return { id: "internal-file", name: "report.pdf", mimeType: "application/pdf", trashed: false, webViewLink: "" }; }, async getMetadata() { throw new Error("not called"); }, async download() { throw new Error("not called"); } },
  });
  assert.equal(failedResult.created, true);
  assert.equal(generated, 0);
  assert.equal(hashes[0]?.byteLength, 32);
  const complete = await uploadFolderDocument({
    upload, user: staff, getDestination: async () => folder(), attempts: attempts("COMPLETE") as never,
    folderAttempts: { async claimFolderUploadAttempt() { return { outcome: "COMPLETE", attemptId: "attempt", attemptStatus: "COMPLETE", driveFileId: "internal-file", operationToken: null, reservationExpiresAt: null, documentId: "document" }; }, async finalizeFolderUploadAttempt() { throw new Error("not called"); } },
    drive: { async generateFileId() { throw new Error("not called"); }, async upload() { throw new Error("not called"); }, async getMetadata() { throw new Error("not called"); }, async download() { throw new Error("not called"); } },
  });
  assert.equal(complete.created, false);
});

test("UPLOADING replay remains in progress without provider mutation", async () => {
  const upload = await validateFolderUploadForm(form());
  let providerCalls = 0;
  await assert.rejects(() => uploadFolderDocument({
    upload, user: staff, getDestination: async () => folder({ uploadEnabled: false, status: "FAILED" }), attempts: attempts("UPLOADING") as never,
    folderAttempts: { async claimFolderUploadAttempt() { return { outcome: "REPLAY", attemptId: "attempt", attemptStatus: "UPLOADING", driveFileId: "internal-file", operationToken: "internal-token", reservationExpiresAt: null, documentId: null }; }, async finalizeFolderUploadAttempt() { throw new Error("not called"); } },
    drive: { async generateFileId() { providerCalls += 1; throw new Error("not called"); }, async upload() { providerCalls += 1; throw new Error("not called"); }, async getMetadata() { throw new Error("not called"); }, async download() { throw new Error("not called"); } },
  }), (error: unknown) => error instanceof DocumentUploadError && error.status === 409);
  assert.equal(providerCalls, 0);
});

test("document POST keeps legacy requests separate and rejects partial folder mode", async () => {
  let legacyCalls = 0;
  let folderCalls = 0;
  const handler = createUploadDocumentHandler({ getAuthorization: async () => ({ kind: "authorized" as const, user: staff }), uploadDocument: async () => { legacyCalls += 1; return { document, created: true }; }, uploadFolderDocument: async () => { folderCalls += 1; return { document, created: true }; } });
  const legacy = new FormData();
  for (const [key, value] of Object.entries({ idempotency_key: "33333333-3333-4333-8333-333333333333", document_type: "BACTI TEST", filing_year: "2027", filing_subcategory: "", document_date: "2027-01-01", subject: "Legacy" })) legacy.set(key, value);
  legacy.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "legacy.pdf", { type: "application/pdf" }));
  assert.equal((await handler(new Request("https://example.test/api/documents", { method: "POST", headers: { origin: "https://example.test" }, body: legacy }))).status, 201);
  assert.equal(legacyCalls, 1);
  const partial = form(); partial.delete("source_relative_path");
  assert.equal((await handler(new Request("https://example.test/api/documents", { method: "POST", headers: { origin: "https://example.test" }, body: partial }))).status, 400);
  const collisionKey = form(); collisionKey.set("normalized_relative_path_key", "browser-chosen");
  assert.equal((await handler(new Request("https://example.test/api/documents", { method: "POST", headers: { origin: "https://example.test" }, body: collisionKey }))).status, 400);
  assert.equal(folderCalls, 0);
});

test("folder POST responses use a safe DTO for first completion and COMPLETE replay", async () => {
  for (const created of [true, false]) {
    const handler = createUploadDocumentHandler({ getAuthorization: async () => ({ kind: "authorized" as const, user: staff }), uploadDocument: async () => ({ document, created: true }), uploadFolderDocument: async () => ({ document, created }) });
    const response = await handler(new Request("https://example.test/api/documents", { method: "POST", headers: { origin: "https://example.test" }, body: form() }));
    const body = await response.json() as { document: Record<string, unknown> };
    assert.equal(response.status, created ? 201 : 200);
    for (const field of ["drive_file_id", "drive_url", "drive_folder_id", "drive_parent_id", "operation_token", "content_sha256", "normalized_relative_path_key"]) assert.equal(field in body.document, false);
    assert.equal(body.document.document_id, "document");
  }
});
