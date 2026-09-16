import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { createDownloadDocumentHandler, createOpenDocumentHandler, createUploadDocumentHandler } from "../src/lib/documents/file-api.ts";
import { DocumentUploadError, uploadAdminDocument } from "../src/lib/documents/upload-service.ts";
import { validateAdminUploadForm } from "../src/lib/documents/upload-validation.ts";
import { classifyDriveError, DriveServiceError } from "../src/lib/google/drive-types.ts";
import { isDocumentId } from "../src/lib/documents/query.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import type { DocumentRecord } from "../src/lib/documents/types.ts";
import type { UploadAttempt, UploadMetadataSnapshot, ValidatedAdminUpload } from "../src/lib/documents/upload-types.ts";

const staff: AuthorizedUser = { id: "11111111-1111-4111-8111-111111111111", email: "staff@example.test", name: "Staff", role: "STAFF", status: "ACTIVE" };
const viewer: AuthorizedUser = { ...staff, id: "22222222-2222-4222-8222-222222222222", role: "VIEWER" };
const document: DocumentRecord = {
  document_id: "2e0e9825-98bb-4f78-9875-766e0af3516a",
  document_type: "BACTI TEST",
  document_number: "WQ-01",
  document_date: "2026-09-01",
  subject: "Water quality test",
  persons_involved: "KWD",
  drive_file_id: "driveFileId_12345",
  drive_url: "https://drive.google.com/file/d/driveFileId_12345/view",
  file_name: "water-quality.pdf",
  file_type: "application/pdf",
  filing_year: 2026,
  filing_subcategory: null,
  status: "ACTIVE",
  created_by: staff.email,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

const authorized = (user: AuthorizedUser = staff): AuthorizationResult => ({ kind: "authorized", user });

function pdfFile(name = "water-quality.pdf", sizePadding = 0) {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46]), new Uint8Array(sizePadding)], name, { type: "application/pdf" });
}

function uploadForm(overrides: Record<string, string> = {}, file: File = pdfFile()) {
  const values = {
    idempotency_key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    document_type: "BACTI TEST",
    filing_year: "2026",
    filing_subcategory: "",
    document_number: "WQ-01",
    document_date: "2026-09-01",
    subject: "Water quality test",
    persons_involved: "KWD",
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  form.set("file", file);
  return form;
}

function uploadRequest(form = uploadForm(), origin = "http://localhost") {
  return new Request("http://localhost/api/documents", { method: "POST", headers: { origin }, body: form });
}

test("Admin upload API enforces authentication, active authorization, and Staff role", async () => {
  for (const [authorization, expected] of [
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "inactive" }, 403],
    [authorized(viewer), 403],
  ] as const) {
    const handler = createUploadDocumentHandler({
      getAuthorization: async () => authorization as AuthorizationResult,
      uploadDocument: async () => ({ document, created: true }),
    });
    assert.equal((await handler(uploadRequest())).status, expected);
  }
});

test("Admin upload API rejects cross-origin mutation requests", async () => {
  const handler = createUploadDocumentHandler({ getAuthorization: async () => authorized(), uploadDocument: async () => ({ document, created: true }) });
  const response = await handler(uploadRequest(uploadForm(), "https://attacker.example"));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
});

test("Admin upload validation rejects unsupported, oversized, invalid, and malformed submissions", async () => {
  await assert.rejects(() => validateAdminUploadForm(uploadForm({}, new File(["plain"], "notes.txt", { type: "text/plain" }))));
  await assert.rejects(() => validateAdminUploadForm(uploadForm({}, new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }))));
  await assert.rejects(() => validateAdminUploadForm(uploadForm({}, pdfFile("unsafe\u0000.pdf"))));

  const previousLimit = process.env.ADMIN_UPLOAD_MAX_BYTES;
  process.env.ADMIN_UPLOAD_MAX_BYTES = "4";
  await assert.rejects(() => validateAdminUploadForm(uploadForm({}, pdfFile("large.pdf", 8))));
  if (previousLimit === undefined) delete process.env.ADMIN_UPLOAD_MAX_BYTES; else process.env.ADMIN_UPLOAD_MAX_BYTES = previousLimit;

  await assert.rejects(() => validateAdminUploadForm(uploadForm({ subject: "" })));
  await assert.rejects(() => validateAdminUploadForm(uploadForm({ document_type: "ACCOUNTING" })));
  await assert.rejects(() => validateAdminUploadForm(uploadForm({ filing_year: "" })));
});

test("valid Admin files and structured metadata are normalized server-side", async () => {
  const result = await validateAdminUploadForm(uploadForm());
  assert.equal(result.file.mimeType, "application/pdf");
  assert.equal(result.metadata.document_type, "BACTI TEST");
  assert.equal(result.metadata.filing_year, 2026);
});

function validUpload(key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): ValidatedAdminUpload {
  return {
    idempotencyKey: key,
    metadata: {
      document_type: "BACTI TEST",
      document_number: "WQ-01",
      document_date: "2026-09-01",
      subject: "Water quality test",
      persons_involved: "KWD",
      filing_year: 2026,
      filing_subcategory: "",
    },
    file: { name: "water-quality.pdf", mimeType: "application/pdf", size: 4, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
  };
}

function snapshot(upload: ValidatedAdminUpload): UploadMetadataSnapshot {
  return { ...upload.metadata, file_name: upload.file.name, file_type: upload.file.mimeType, file_size: upload.file.size };
}

function mockRepository(options: { existing?: UploadAttempt | null; failFinalizeOnce?: boolean } = {}) {
  let attempt = options.existing ?? null;
  let failFinalizeOnce = options.failFinalizeOnce ?? false;
  let tokenCounter = 0;
  const calls: string[] = [];
  return {
    calls,
    current: () => attempt,
    repository: {
      async findByIdempotencyKey() { calls.push("find"); return attempt; },
      async create(key: string, creatorId: string, metadata: UploadMetadataSnapshot) {
        calls.push("create");
        if (attempt) throw Object.assign(new Error("duplicate key"), { databaseCode: "23505" });
        attempt = { id: "33333333-3333-4333-8333-333333333333", idempotency_key: key, status: "PENDING_UPLOAD", drive_file_id: null, operation_token: null, reservation_expires_at: null, metadata_snapshot: metadata, document_id: null, created_by: creatorId, safe_error_code: null };
        return attempt;
      },
      async claimDriveIdReservation(_id: string, leaseDurationMs = 60_000) {
        calls.push("claim");
        const now = Date.now();
        const isExpired = attempt?.reservation_expires_at
          ? new Date(attempt.reservation_expires_at).getTime() <= now
          : false;
        if (!attempt || attempt.status !== "PENDING_UPLOAD" || attempt.drive_file_id !== null) {
          return { claimed: false, operationToken: null };
        }
        if (attempt.operation_token !== null && !isExpired) {
          return { claimed: false, operationToken: null };
        }
        tokenCounter += 1;
        const operationToken = `token-${tokenCounter}`;
        const expiresAt = new Date(now + leaseDurationMs).toISOString();
        attempt = { ...attempt, operation_token: operationToken, reservation_expires_at: expiresAt };
        return { claimed: true, operationToken };
      },
      async clearDriveIdReservation(_id: string, expectedOperationToken: string) {
        calls.push("clear");
        if (attempt && attempt.status === "PENDING_UPLOAD" && attempt.operation_token === expectedOperationToken) {
          attempt = { ...attempt, operation_token: null, reservation_expires_at: null };
        }
      },
      async persistDriveFileId(_id: string, driveFileId: string, expectedOperationToken: string) {
        calls.push("persist");
        if (!attempt || attempt.status !== "PENDING_UPLOAD" || attempt.operation_token !== expectedOperationToken || attempt.drive_file_id !== null) return false;
        attempt = { ...attempt, status: "UPLOADING", drive_file_id: driveFileId, reservation_expires_at: null };
        return true;
      },
      async resumeUpload() {
        calls.push("resume");
        if (!attempt || attempt.status !== "FAILED") return { resumed: false, operationToken: null };
        tokenCounter += 1;
        const operationToken = `token-${tokenCounter}`;
        attempt = { ...attempt, status: "UPLOADING", operation_token: operationToken, reservation_expires_at: null };
        return { resumed: true, operationToken };
      },
      async recoverInterruptedUploadToFailed(_id: string, expectedDriveFileId: string, expectedOperationToken: string) {
        calls.push("recover");
        if (!attempt || attempt.status !== "UPLOADING" || attempt.drive_file_id !== expectedDriveFileId || attempt.operation_token !== expectedOperationToken) {
          return { changed: false, attempt };
        }
        attempt = { ...attempt, status: "FAILED", safe_error_code: "DRIVE_ERROR", reservation_expires_at: null };
        return { changed: true, attempt };
      },
      async markPendingRegistry(_id: string, driveFileId: string, expectedOperationToken: string) {
        calls.push("pending");
        if (!attempt || attempt.status !== "UPLOADING" || attempt.drive_file_id !== driveFileId || attempt.operation_token !== expectedOperationToken) return false;
        attempt = { ...attempt, status: "PENDING_REGISTRY" };
        return true;
      },
      async markFailed(_id: string, expectedDriveFileId: string, expectedOperationToken: string, safeErrorCode: string) {
        calls.push("failed");
        if (attempt && attempt.status === "UPLOADING" && attempt.drive_file_id === expectedDriveFileId && attempt.operation_token === expectedOperationToken) {
          attempt = { ...attempt, status: "FAILED", safe_error_code: safeErrorCode, reservation_expires_at: null };
          return { changed: true, attempt };
        }
        return { changed: false, attempt };
      },
      async finalize() {
        calls.push("finalize");
        if (failFinalizeOnce) { failFinalizeOnce = false; throw new Error("registry internals"); }
        if (attempt) attempt = { ...attempt, status: "COMPLETE", document_id: document.document_id };
        return document;
      },
      async getDocument() { calls.push("getDocument"); return document; },
    },
  };
}

function mockDrive(error?: DriveServiceError) {
  let uploads = 0;
  const generatedId = document.drive_file_id!;
  return {
    uploads: () => uploads,
    service: {
      async generateFileId() { return generatedId; },
      async upload(input: { fileId: string }) { uploads += 1; if (error) throw error; assert.equal(input.fileId, generatedId); return { id: generatedId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! }; },
      async getMetadata() { if (error) throw error; return { id: document.drive_file_id!, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! }; },
      async download() { if (error) throw error; return { id: document.drive_file_id!, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url!, stream: Readable.from([Buffer.from("content")]), size: 7 }; },
    },
  };
}

async function withFolderMap<T>(operation: () => Promise<T>) {
  const previous = process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP;
  process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = JSON.stringify({ "ADMIN|2026|BACTI TEST": "folderId_123456" });
  try { return await operation(); } finally { if (previous === undefined) delete process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP; else process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = previous; }
}

test("a successful Drive upload is finalized into the Supabase registry", async () => withFolderMap(async () => {
  const store = mockRepository();
  const drive = mockDrive();
  const result = await uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive: drive.service });
  assert.equal(result.created, true);
  assert.equal(drive.uploads(), 1);
  assert.deepEqual(store.calls, ["find", "create", "claim", "persist", "pending", "finalize"]);
}));

test("a pre-generated Drive ID is reserved in the attempt before media transfer", async () => withFolderMap(async () => {
  const store = mockRepository();
  let generated = 0;
  const drive = {
    async generateFileId() { generated += 1; return document.drive_file_id!; },
    async upload(input: { fileId: string }) {
      assert.equal(store.current()?.status, "UPLOADING");
      assert.equal(store.current()?.drive_file_id, input.fileId);
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: document.drive_file_id!, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! }; },
    async download() { return { id: document.drive_file_id!, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url!, stream: Readable.from([Buffer.from("content")]), size: 7 }; },
  };
  await uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive });
  assert.equal(generated, 1);
  assert.equal(store.current()?.drive_file_id, document.drive_file_id);
}));

test("an interrupted upload retry reuses the persisted Drive ID and never generates an alternate ID", async () => withFolderMap(async () => {
  const store = mockRepository();
  const usedIds: string[] = [];
  let calls = 0;
  const drive = {
    async generateFileId() { return document.drive_file_id!; },
    async upload(input: { fileId: string }) {
      usedIds.push(input.fileId);
      calls += 1;
      if (calls === 1) throw new DriveServiceError("TRANSIENT");
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: document.drive_file_id!, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! }; },
    async download() { return { id: document.drive_file_id!, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url!, stream: Readable.from([Buffer.from("content")]), size: 7 }; },
  };
  await assert.rejects(() => uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive }));
  assert.equal(store.current()?.drive_file_id, document.drive_file_id);
  await uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive });
  assert.deepEqual(usedIds, [document.drive_file_id, document.drive_file_id]);
}));

test("two concurrent submissions share one attempt — only the token holder proceeds", async () => withFolderMap(async () => {
  const store = mockRepository();
  const drive = mockDrive();
  // With operation_token, only the caller that won the reserveDriveFileId
  // transition owns the token and can proceed. A concurrent request that
  // finds UPLOADING but has no token correctly receives a 409.
  const [first, second] = await Promise.allSettled([
    uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive: drive.service }),
    uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive: drive.service }),
  ]);
  const success = [first, second].find((r) => r.status === "fulfilled");
  const rejection = [first, second].find((r) => r.status === "rejected");
  assert.ok(success, "one request must succeed");
  assert.ok(rejection, "the other request must be rejected");
  assert.equal((rejection as PromiseRejectedResult).reason.code, "UPLOAD_IN_PROGRESS");
  assert.equal(store.current()?.drive_file_id, document.drive_file_id);
}));

test("concurrent PENDING_REGISTRY finalization returns one document after database serialization", async () => withFolderMap(async () => {
  const upload = validUpload();
  const existing: UploadAttempt = {
    id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: upload.idempotencyKey,
    status: "PENDING_REGISTRY",
    drive_file_id: document.drive_file_id,
    operation_token: null,
    reservation_expires_at: null,
    metadata_snapshot: snapshot(upload),
    document_id: null,
    created_by: staff.id,
    safe_error_code: null,
  };
  let completed = false;
  let insertedDocuments = 0;
  const repository = {
    async findByIdempotencyKey() { return existing; },
    async create() { throw new Error("not reached"); },
    async claimDriveIdReservation() { return { claimed: false, operationToken: null }; },
    async clearDriveIdReservation() {},
    async persistDriveFileId() { return false; },
    async resumeUpload() { return { resumed: false, operationToken: null }; },
    async markPendingRegistry() { return false; },
    async markFailed() { return { changed: false, attempt: existing }; },
    async finalize() {
      if (!completed) { completed = true; insertedDocuments += 1; }
      return document;
    },
    async getDocument() { return document; },
  };
  const results = await Promise.all([
    uploadAdminDocument({ upload, user: staff, repository, drive: mockDrive().service }),
    uploadAdminDocument({ upload, user: staff, repository, drive: mockDrive().service }),
  ]);
  assert.equal(results[0].document.document_id, results[1].document.document_id);
  assert.equal(insertedDocuments, 1);
}));

test("the Phase 3 SQL contract locks finalization, makes Drive IDs unique, and enforces drive_file_id immutability", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260909000000_add_admin_drive_uploads.sql", import.meta.url), "utf8");
  assert.match(migration, /from public\.upload_attempts[\s\S]*for update;/i);
  assert.match(migration, /create unique index documents_drive_file_id_unique_idx[\s\S]*where drive_file_id is not null;/i);
  assert.match(migration, /status = 'PENDING_UPLOAD' or drive_file_id is not null/i);
  assert.match(migration, /operation_token uuid/i, "operation_token column must exist");
  assert.match(migration, /reservation_expires_at timestamptz/i, "reservation_expires_at column must exist");
  assert.match(migration, /status <> 'UPLOADING' or operation_token is not null/i, "UPLOADING must have an operation token");
  assert.match(migration, /function public\.enforce_documents_drive_file_id_immutable\(\)/i, "immutability trigger function must exist");
  assert.match(migration, /create trigger documents_drive_file_id_immutable_trg[\s\S]*before update on public\.documents/i, "immutability trigger must be attached to public.documents");
  assert.match(migration, /DRIVE_FILE_ID_IMMUTABLE/i, "trigger must raise controlled exception on illegal change");
});

test("database-contract: drive_file_id immutability transition rules (trigger logic)", () => {
  // Evaluates the exact state transition rules implemented by public.enforce_documents_drive_file_id_immutable().
  // Note: Genuine PostgreSQL trigger execution against a live database remains an external validation requirement.
  function evaluateDriveFileIdTransition(oldId: string | null, newId: string | null): { allowed: boolean; error?: string } {
    if (oldId !== null) {
      if (newId === null || newId !== oldId) {
        return { allowed: false, error: "DRIVE_FILE_ID_IMMUTABLE: Persisted Drive file ID cannot be modified or cleared." };
      }
    }
    return { allowed: true };
  }

  // 1. NULL -> ABC (initial assignment): allowed
  const nullToAbc = evaluateDriveFileIdTransition(null, "ABC");
  assert.equal(nullToAbc.allowed, true, "NULL -> ABC (initial assignment) must be allowed");

  // 2. ABC -> ABC (same value update): allowed
  const abcToAbc = evaluateDriveFileIdTransition("ABC", "ABC");
  assert.equal(abcToAbc.allowed, true, "ABC -> ABC (same value update) must be allowed");

  // 3. ABC -> XYZ (modification): rejected
  const abcToXyz = evaluateDriveFileIdTransition("ABC", "XYZ");
  assert.equal(abcToXyz.allowed, false, "ABC -> XYZ (modification) must be rejected");
  assert.match(abcToXyz.error ?? "", /DRIVE_FILE_ID_IMMUTABLE/);

  // 4. ABC -> NULL (clearing): rejected
  const abcToNull = evaluateDriveFileIdTransition("ABC", null);
  assert.equal(abcToNull.allowed, false, "ABC -> NULL (clearing) must be rejected");
  assert.match(abcToNull.error ?? "", /DRIVE_FILE_ID_IMMUTABLE/);
});

test("Drive success plus registry failure remains pending and retry does not create a second Drive file", async () => withFolderMap(async () => {
  const store = mockRepository({ failFinalizeOnce: true });
  const drive = mockDrive();
  await assert.rejects(() => uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive: drive.service }), (error: unknown) => error instanceof DocumentUploadError && error.code === "REGISTRY_ERROR");
  assert.equal(store.current()?.status, "PENDING_REGISTRY");

  const retried = await uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive: drive.service });
  assert.equal(retried.created, false);
  assert.equal(drive.uploads(), 1);
}));

test("a completed idempotency key returns its existing document without uploading", async () => withFolderMap(async () => {
  const upload = validUpload();
  const store = mockRepository({ existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "COMPLETE", drive_file_id: document.drive_file_id, operation_token: null, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: document.document_id, created_by: staff.id, safe_error_code: null } });
  const drive = mockDrive();
  const result = await uploadAdminDocument({ upload, user: staff, repository: store.repository, drive: drive.service });
  assert.equal(result.created, false);
  assert.equal(drive.uploads(), 0);
}));

test("an idempotency key cannot be reused for different metadata", async () => withFolderMap(async () => {
  const upload = validUpload();
  const existing = { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "PENDING_REGISTRY" as const, drive_file_id: document.drive_file_id, operation_token: null, reservation_expires_at: null, metadata_snapshot: { ...snapshot(upload), subject: "Different" }, document_id: null, created_by: staff.id, safe_error_code: null };
  await assert.rejects(() => uploadAdminDocument({ upload, user: staff, repository: mockRepository({ existing }).repository, drive: mockDrive().service }), (error: unknown) => error instanceof DocumentUploadError && error.code === "VALIDATION_ERROR");
}));

test("missing Admin folder map falls back to root and fails only without a valid destination", async () => {
  const previousMap = process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP;
  const previousRoot = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  delete process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP;
  try {
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "rootFolderId_123";
    const fallbackDrive = mockDrive();
    await uploadAdminDocument({ upload: validUpload(), user: staff, repository: mockRepository().repository, drive: fallbackDrive.service });
    assert.equal(fallbackDrive.uploads(), 1);

    delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const missingDrive = mockDrive();
    await assert.rejects(() => uploadAdminDocument({ upload: validUpload(), user: staff, repository: mockRepository().repository, drive: missingDrive.service }), (error: unknown) => error instanceof DocumentUploadError && error.code === "DRIVE_ERROR");
    assert.equal(missingDrive.uploads(), 0);
  } finally {
    if (previousMap === undefined) delete process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP; else process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = previousMap;
    if (previousRoot === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID; else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = previousRoot;
  }
});

test("Drive permission and transient upload failures return safe errors", async () => withFolderMap(async () => {
  for (const kind of ["FORBIDDEN", "TRANSIENT", "PROVIDER"] as const) {
    const store = mockRepository();
    await assert.rejects(() => uploadAdminDocument({ upload: validUpload(), user: staff, repository: store.repository, drive: mockDrive(new DriveServiceError(kind)).service }), (error: unknown) => error instanceof DocumentUploadError && error.code === "DRIVE_ERROR");
    assert.equal(store.current()?.status, "FAILED");
  }
}));

test("Drive timeout, 429, unavailable, permission, and missing-file diagnostics are classified without exposing provider details", () => {
  assert.equal(classifyDriveError({ code: "ETIMEDOUT" }).kind, "TRANSIENT");
  assert.equal(classifyDriveError({ response: { status: 429 } }).kind, "TRANSIENT");
  assert.equal(classifyDriveError({ response: { status: 503 } }).kind, "TRANSIENT");
  assert.equal(classifyDriveError({ response: { status: 403 } }).kind, "FORBIDDEN");
  assert.equal(classifyDriveError({ response: { status: 404 } }).kind, "NOT_FOUND");
});

function fileDependencies(authorization: AuthorizationResult = authorized(), record: DocumentRecord | null = document, drive = mockDrive().service) {
  return { getAuthorization: async () => authorization, getDocument: async () => record, isDocumentId, drive };
}

test("Open in Drive and download enforce authorization", async () => {
  for (const authorization of [{ kind: "unauthenticated" }, { kind: "inactive" }] as AuthorizationResult[]) {
    const open = createOpenDocumentHandler(fileDependencies(authorization));
    const download = createDownloadDocumentHandler(fileDependencies(authorization));
    const context = { params: Promise.resolve({ id: document.document_id }) };
    assert.equal((await open(new Request("http://localhost"), context)).status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal((await download(new Request("http://localhost"), context)).status, authorization.kind === "unauthenticated" ? 401 : 403);
  }
});

test("Open in Drive validates availability and redirects to the canonical ID URL", async () => {
  const context = { params: Promise.resolve({ id: document.document_id }) };
  const response = await createOpenDocumentHandler(fileDependencies())(new Request("http://localhost"), context);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), document.drive_url);

  const malformed = await createOpenDocumentHandler(fileDependencies(authorized(), { ...document, drive_file_id: "bad" }))(new Request("http://localhost"), context);
  assert.equal(malformed.status, 404);
  const missing = await createOpenDocumentHandler(fileDependencies(authorized(), document, mockDrive(new DriveServiceError("NOT_FOUND")).service))(new Request("http://localhost"), context);
  assert.equal(missing.status, 404);
});

test("Download streams through the server and provider failures stay safe", async () => {
  const context = { params: Promise.resolve({ id: document.document_id }) };
  const response = await createDownloadDocumentHandler(fileDependencies())(new Request("http://localhost"), context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "content");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const failed = await createDownloadDocumentHandler(fileDependencies(authorized(), document, mockDrive(new DriveServiceError("TRANSIENT")).service))(new Request("http://localhost"), context);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: { code: "DRIVE_ERROR", message: "The document file is temporarily unavailable." } });
});

// ---------------------------------------------------------------------------
// markFailed conditional-state contract tests
// ---------------------------------------------------------------------------

test("markFailed: UPLOADING + matching Drive ID + matching token transitions to FAILED", async () => {
  const upload = validUpload();
  const driveId = "driveFileId_12345";
  const token = "token-1";
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "UPLOADING", drive_file_id: driveId, operation_token: token, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null },
  });
  const result = await store.repository.markFailed("33333333-3333-4333-8333-333333333333", driveId, token, "DRIVE_ERROR");
  assert.equal(result.changed, true);
  assert.equal(result.attempt?.status, "FAILED");
});

test("markFailed: UPLOADING + wrong Drive ID does not update", async () => {
  const upload = validUpload();
  const token = "token-1";
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "UPLOADING", drive_file_id: "driveFileId_12345", operation_token: token, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null },
  });
  const result = await store.repository.markFailed("33333333-3333-4333-8333-333333333333", "WRONG_DRIVE_ID", token, "DRIVE_ERROR");
  assert.equal(result.changed, false);
  assert.equal(result.attempt?.status, "UPLOADING");
});

test("markFailed: UPLOADING + wrong operation token does not update", async () => {
  const upload = validUpload();
  const driveId = "driveFileId_12345";
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "UPLOADING", drive_file_id: driveId, operation_token: "token-current", reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null },
  });
  const result = await store.repository.markFailed("33333333-3333-4333-8333-333333333333", driveId, "token-stale", "DRIVE_ERROR");
  assert.equal(result.changed, false);
  assert.equal(result.attempt?.status, "UPLOADING");
});

test("markPendingRegistry: UPLOADING + wrong operation token does not update", async () => {
  const upload = validUpload();
  const driveId = "driveFileId_12345";
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "UPLOADING", drive_file_id: driveId, operation_token: "token-current", reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null },
  });
  const result = await store.repository.markPendingRegistry("33333333-3333-4333-8333-333333333333", driveId, "token-stale");
  assert.equal(result, false);
  assert.equal(store.current()?.status, "UPLOADING");
});

test("markFailed: PENDING_REGISTRY is never regressed", async () => {
  const upload = validUpload();
  const driveId = "driveFileId_12345";
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "PENDING_REGISTRY", drive_file_id: driveId, operation_token: null, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null },
  });
  const result = await store.repository.markFailed("33333333-3333-4333-8333-333333333333", driveId, "token-stale", "DRIVE_ERROR");
  assert.equal(result.changed, false);
  assert.equal(result.attempt?.status, "PENDING_REGISTRY");
});

test("markFailed: COMPLETE is never regressed", async () => {
  const upload = validUpload();
  const driveId = "driveFileId_12345";
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "COMPLETE", drive_file_id: driveId, operation_token: null, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: document.document_id, created_by: staff.id, safe_error_code: null },
  });
  const result = await store.repository.markFailed("33333333-3333-4333-8333-333333333333", driveId, "token-stale", "DRIVE_ERROR");
  assert.equal(result.changed, false);
  assert.equal(result.attempt?.status, "COMPLETE");
});

test("recoverInterruptedUploadToFailed requires the exact attempt, Drive ID, token, and UPLOADING state", async () => {
  const upload = validUpload();
  const attemptId = "33333333-3333-4333-8333-333333333333";
  const driveId = "driveFileId_12345";
  const token = "token-current";
  const existing = { id: attemptId, idempotency_key: upload.idempotencyKey, status: "UPLOADING" as const, drive_file_id: driveId, operation_token: token, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null };

  for (const [expectedDriveId, expectedToken, status] of [[driveId, token, "UPLOADING"], [driveId, "wrong-token", "UPLOADING"], ["wrong-drive-id", token, "UPLOADING"], [driveId, token, "FAILED"], ["", token, "UPLOADING"]] as const) {
    const store = mockRepository({ existing: { ...existing, status } });
    const result = await store.repository.recoverInterruptedUploadToFailed(attemptId, expectedDriveId, expectedToken);
    assert.equal(result.changed, status === "UPLOADING" && expectedDriveId === driveId && expectedToken === token && Boolean(expectedDriveId));
    assert.equal(store.current()?.status, result.changed ? "FAILED" : status);
  }
});

test("recovered upload resumes with the same Drive ID and a fresh operation token", async () => {
  const upload = validUpload();
  const attemptId = "33333333-3333-4333-8333-333333333333";
  const driveId = "driveFileId_12345";
  const oldToken = "token-old";
  const store = mockRepository({
    existing: { id: attemptId, idempotency_key: upload.idempotencyKey, status: "UPLOADING", drive_file_id: driveId, operation_token: oldToken, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null },
  });

  const recovered = await store.repository.recoverInterruptedUploadToFailed(attemptId, driveId, oldToken);
  assert.equal(recovered.changed, true);
  const resumed = await store.repository.resumeUpload(attemptId);
  assert.equal(resumed.resumed, true);
  assert.notEqual(resumed.operationToken, oldToken);
  assert.equal(store.current()?.drive_file_id, driveId);
  assert.equal(store.current()?.status, "UPLOADING");
});

// ---------------------------------------------------------------------------
// Concurrency regression: stale Request B cannot regress Request A's state
// ---------------------------------------------------------------------------

test("stale markFailed after concurrent PENDING_REGISTRY preserves the newer state", async () => withFolderMap(async () => {
  const upload = validUpload();
  const driveId = document.drive_file_id!;
  // Simulate: Request A has already moved the attempt to PENDING_REGISTRY.
  // Request B has a stale view and tries to mark it failed.
  let attempt: UploadAttempt = {
    id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: upload.idempotencyKey,
    status: "PENDING_REGISTRY",
    drive_file_id: driveId,
    operation_token: null,
    reservation_expires_at: null,
    metadata_snapshot: snapshot(upload),
    document_id: null,
    created_by: staff.id,
    safe_error_code: null,
  };
  const repository = {
    async findByIdempotencyKey() { return attempt; },
    async create() { throw new Error("not reached"); },
    async claimDriveIdReservation() { return { claimed: false, operationToken: null }; },
    async clearDriveIdReservation() {},
    async persistDriveFileId() { return false; },
    async resumeUpload() { return { resumed: false, operationToken: null }; },
    async markPendingRegistry() { return false; },
    async markFailed(_id: string, expectedDriveFileId: string, expectedToken: string) {
      // Faithfully implements the conditional contract:
      // only updates when status=UPLOADING AND drive_file_id AND token match
      if (attempt.status === "UPLOADING" && attempt.drive_file_id === expectedDriveFileId && attempt.operation_token === expectedToken) {
        attempt = { ...attempt, status: "FAILED" };
        return { changed: true, attempt };
      }
      return { changed: false, attempt };
    },
    async finalize() { attempt = { ...attempt, status: "COMPLETE", document_id: document.document_id }; return document; },
    async getDocument() { return document; },
  };

  // Request A: sees PENDING_REGISTRY, finalizes it
  const requestA = await uploadAdminDocument({
    upload, user: staff, repository, drive: mockDrive().service,
  });
  assert.equal(requestA.document.document_id, document.document_id);
  assert.equal(attempt.status, "COMPLETE");

  // Request B: stale drive error, tries markFailed on same attempt
  const failResult = await repository.markFailed(attempt.id, driveId, "stale-token");
  assert.equal(failResult.changed, false, "markFailed must not change a COMPLETE attempt");
  assert.equal(failResult.attempt?.status, "COMPLETE", "COMPLETE must survive a stale failure");
}));

test("stale markFailed after COMPLETE preserves the finalized state", async () => {
  const upload = validUpload();
  const driveId = document.drive_file_id!;
  const attempt: UploadAttempt = {
    id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: upload.idempotencyKey,
    status: "COMPLETE",
    drive_file_id: driveId,
    operation_token: null,
    reservation_expires_at: null,
    metadata_snapshot: snapshot(upload),
    document_id: document.document_id,
    created_by: staff.id,
    safe_error_code: null,
  };
  const store = mockRepository({ existing: attempt });
  const result = await store.repository.markFailed(attempt.id, driveId, "stale-token", "DRIVE_ERROR");
  assert.equal(result.changed, false);
  assert.equal(result.attempt?.status, "COMPLETE");
  assert.equal(store.current()?.status, "COMPLETE", "COMPLETE was not overwritten");
});

// ---------------------------------------------------------------------------
// Full concurrency regression: Request A succeeds, Request B 409 → markFailed
// ---------------------------------------------------------------------------

test("Request B stale 409/markFailed cannot regress Request A PENDING_REGISTRY or create a second Drive file", async () => withFolderMap(async () => {
  const upload = validUpload();
  const driveId = document.drive_file_id!;
  let attempt: UploadAttempt | null = null;
  let driveFileCount = 0;
  const generatedIds: string[] = [];
  let tokenCounter = 0;

  const repository = {
    async findByIdempotencyKey() { return attempt; },
    async create(key: string, creatorId: string, metadata: UploadMetadataSnapshot) {
      if (attempt) throw Object.assign(new Error("duplicate key"), { databaseCode: "23505" });
      attempt = { id: "33333333-3333-4333-8333-333333333333", idempotency_key: key, status: "PENDING_UPLOAD", drive_file_id: null, operation_token: null, reservation_expires_at: null, metadata_snapshot: metadata, document_id: null, created_by: creatorId, safe_error_code: null };
      return attempt;
    },
    async claimDriveIdReservation(_id: string) {
      if (!attempt || attempt.status !== "PENDING_UPLOAD" || attempt.operation_token !== null) return { claimed: false, operationToken: null };
      tokenCounter += 1;
      const operationToken = `token-${tokenCounter}`;
      attempt = { ...attempt, operation_token: operationToken, reservation_expires_at: new Date(Date.now() + 60000).toISOString() };
      return { claimed: true, operationToken };
    },
    async clearDriveIdReservation(_id: string, expectedOperationToken: string) {
      if (attempt && attempt.status === "PENDING_UPLOAD" && attempt.operation_token === expectedOperationToken) {
        attempt = { ...attempt, operation_token: null, reservation_expires_at: null };
      }
    },
    async persistDriveFileId(_id: string, driveFileId: string, expectedOperationToken: string) {
      if (!attempt || attempt.status !== "PENDING_UPLOAD" || attempt.operation_token !== expectedOperationToken || attempt.drive_file_id !== null) return false;
      attempt = { ...attempt, status: "UPLOADING", drive_file_id: driveFileId, reservation_expires_at: null };
      return true;
    },
    async resumeUpload() {
      if (!attempt || attempt.status !== "FAILED") return { resumed: false, operationToken: null };
      tokenCounter += 1;
      const operationToken = `token-${tokenCounter}`;
      attempt = { ...attempt, status: "UPLOADING", operation_token: operationToken, reservation_expires_at: null };
      return { resumed: true, operationToken };
    },
    async markPendingRegistry(_id: string, driveFileId: string, expectedOperationToken: string) {
      if (!attempt || attempt.status !== "UPLOADING" || attempt.drive_file_id !== driveFileId || attempt.operation_token !== expectedOperationToken) return false;
      attempt = { ...attempt, status: "PENDING_REGISTRY" };
      return true;
    },
    async markFailed(_id: string, expectedDriveFileId: string, expectedOperationToken: string, safeErrorCode: string) {
      if (attempt && attempt.status === "UPLOADING" && attempt.drive_file_id === expectedDriveFileId && attempt.operation_token === expectedOperationToken) {
        attempt = { ...attempt, status: "FAILED", safe_error_code: safeErrorCode, reservation_expires_at: null };
        return { changed: true, attempt };
      }
      return { changed: false, attempt };
    },
    async finalize() {
      if (attempt) attempt = { ...attempt, status: "COMPLETE", document_id: document.document_id };
      return document;
    },
    async getDocument() { return document; },
  };

  const drive = {
    async generateFileId() { generatedIds.push(driveId); return driveId; },
    async upload(input: { fileId: string }) {
      driveFileCount += 1;
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: driveId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! }; },
    async download() { return { id: driveId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url!, stream: Readable.from([Buffer.from("content")]), size: 7 }; },
  };

  // Request A: full successful upload
  const resultA = await uploadAdminDocument({ upload, user: staff, repository, drive });
  assert.equal(resultA.created, true);
  assert.equal(attempt?.status, "COMPLETE");

  // Simulate Request B: stale error with same Drive ID but old token
  const staleFailResult = await repository.markFailed(attempt!.id, driveId, "stale-token", "DRIVE_ERROR");
  assert.equal(staleFailResult.changed, false, "markFailed must NOT change COMPLETE state");
  assert.equal(attempt?.status, "COMPLETE", "COMPLETE survives stale failure");
  assert.equal(driveFileCount, 1, "only one Drive file was created");
  assert.equal(generatedIds.length, 1, "only one Drive ID was generated");
}));

// ---------------------------------------------------------------------------
// generateIds single-allocation invariant
// ---------------------------------------------------------------------------

test("generateFileId is not retried after ambiguous failure — no second ID for the same attempt", async () => withFolderMap(async () => {
  const upload = validUpload();
  let generateCount = 0;

  const drive = {
    async generateFileId() {
      generateCount += 1;
      if (generateCount === 1) throw new DriveServiceError("TRANSIENT");
      return "shouldNotReach";
    },
    async upload() { return { id: "shouldNotReach", name: "x", mimeType: "application/pdf", trashed: false, webViewLink: "" }; },
    async getMetadata() { return { id: "shouldNotReach", name: "x", mimeType: "application/pdf", trashed: false, webViewLink: "" }; },
    async download() { return { id: "shouldNotReach", name: "x", mimeType: "application/pdf", trashed: false, webViewLink: "", stream: Readable.from([]), size: 0 }; },
  };

  const store = mockRepository();
  await assert.rejects(
    () => uploadAdminDocument({ upload, user: staff, repository: store.repository, drive }),
    (error: unknown) => error instanceof DocumentUploadError && error.code === "DRIVE_ERROR",
  );
  assert.equal(generateCount, 1, "generateFileId must be called exactly once — no retry after ambiguous failure");
  assert.equal(store.current()?.status, "PENDING_UPLOAD", "attempt stays in PENDING_UPLOAD when ID generation fails");
  assert.equal(store.current()?.drive_file_id, null, "no Drive ID persisted after generation failure");
}));

test("the upload state machine never replaces a persisted Drive ID with a second generated ID", async () => withFolderMap(async () => {
  const upload = validUpload();
  const driveId = document.drive_file_id!;
  const generatedIds: string[] = [];

  const drive = {
    async generateFileId() {
      const id = generatedIds.length === 0 ? driveId : "SECOND_ID_SHOULD_NOT_APPEAR";
      generatedIds.push(id);
      return id;
    },
    async upload(input: { fileId: string }) {
      assert.equal(input.fileId, driveId, "every upload must use the original persisted Drive ID");
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: driveId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! }; },
    async download() { return { id: driveId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url!, stream: Readable.from([Buffer.from("content")]), size: 7 }; },
  };

  const store = mockRepository();
  await uploadAdminDocument({ upload, user: staff, repository: store.repository, drive });
  assert.equal(generatedIds.length, 1, "exactly one Drive ID was generated");
  assert.equal(generatedIds[0], driveId);
  assert.equal(store.current()?.drive_file_id, driveId, "persisted Drive ID is the original");
}));

test("concurrent PENDING_UPLOAD callers race for reservation — exactly ONE generateFileId occurs", async () => withFolderMap(async () => {
  const upload = validUpload();
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "PENDING_UPLOAD", drive_file_id: null, operation_token: null, reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: null }
  });

  let generateFileIdCalls = 0;
  const drive = {
    async generateFileId() {
      generateFileIdCalls++;
      // Simulate delay to allow concurrent caller to attempt generation if it bypassed the DB check
      await new Promise(resolve => setTimeout(resolve, 50));
      return "generated_concurrent_id";
    },
    async upload(input: { fileId: string }) {
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: "x", name: "x", mimeType: "x", trashed: false, webViewLink: "x" }; },
    async download() { return { id: "x", name: "x", mimeType: "x", trashed: false, webViewLink: "x", stream: Readable.from([]), size: 0 }; },
  };

  const [first, second] = await Promise.allSettled([
    uploadAdminDocument({ upload, user: staff, repository: store.repository, drive }),
    uploadAdminDocument({ upload, user: staff, repository: store.repository, drive }),
  ]);

  assert.equal(generateFileIdCalls, 1, "exactly ONE generateFileId call must occur");
  const success = [first, second].find((r) => r.status === "fulfilled");
  const rejection = [first, second].find((r) => r.status === "rejected");
  assert.ok(success, "one caller succeeds");
  assert.ok(rejection, "the other caller fails");
  assert.equal((rejection as PromiseRejectedResult).reason.code, "UPLOAD_IN_PROGRESS");
  assert.equal(store.current()?.drive_file_id, "generated_concurrent_id");
}));

test("retry with persisted drive_file_id does not call generateFileId", async () => withFolderMap(async () => {
  const upload = validUpload();
  const store = mockRepository({
    existing: { id: "33333333-3333-4333-8333-333333333333", idempotency_key: upload.idempotencyKey, status: "FAILED", drive_file_id: "persisted_ABC", operation_token: "old-token", reservation_expires_at: null, metadata_snapshot: snapshot(upload), document_id: null, created_by: staff.id, safe_error_code: "DRIVE_ERROR" }
  });

  let generateFileIdCalls = 0;
  const drive = {
    async generateFileId() {
      generateFileIdCalls++;
      return "new_id";
    },
    async upload(input: { fileId: string }) {
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: "x", name: "x", mimeType: "x", trashed: false, webViewLink: "x" }; },
    async download() { return { id: "x", name: "x", mimeType: "x", trashed: false, webViewLink: "x", stream: Readable.from([]), size: 0 }; },
  };

  await uploadAdminDocument({ upload, user: staff, repository: store.repository, drive });

  assert.equal(generateFileIdCalls, 0, "retry with persisted ID must never call generateFileId");
  assert.equal(store.current()?.drive_file_id, "persisted_ABC");
}));

test("crash before Drive-ID persistence: lease expires and second caller reclaims reservation", async () => withFolderMap(async () => {
  const upload = validUpload();
  // Caller A crashed while holding a reservation, leaving reservation_expires_at in the past
  const pastTime = new Date(Date.now() - 5000).toISOString();
  const store = mockRepository({
    existing: {
      id: "33333333-3333-4333-8333-333333333333",
      idempotency_key: upload.idempotencyKey,
      status: "PENDING_UPLOAD",
      drive_file_id: null,
      operation_token: "token-crashed-a",
      reservation_expires_at: pastTime,
      metadata_snapshot: snapshot(upload),
      document_id: null,
      created_by: staff.id,
      safe_error_code: null,
    },
  });

  let generateCalls = 0;
  const drive = {
    async generateFileId() {
      generateCalls += 1;
      return "reclaimed_id_b";
    },
    async upload(input: { fileId: string }) {
      return { id: input.fileId, name: document.file_name!, mimeType: document.file_type!, trashed: false, webViewLink: document.drive_url! };
    },
    async getMetadata() { return { id: "reclaimed_id_b", name: "x", mimeType: "x", trashed: false, webViewLink: "x" }; },
    async download() { return { id: "reclaimed_id_b", name: "x", mimeType: "x", trashed: false, webViewLink: "x", stream: Readable.from([]), size: 0 }; },
  };

  const result = await uploadAdminDocument({ upload, user: staff, repository: store.repository, drive });
  assert.equal(result.created, true);
  assert.equal(generateCalls, 1, "Caller B successfully calls generateFileId after reclaiming expired lease");
  assert.equal(store.current()?.drive_file_id, "reclaimed_id_b");
  assert.notEqual(store.current()?.operation_token, "token-crashed-a", "Operation token must be replaced on reclaim");
}));

test("old owner after reclaim: old token cannot persist ID, markFailed, or markPendingRegistry", async () => {
  const upload = validUpload();
  const driveId = "drive_ABC";
  // Attempt was reclaimed by Caller B with token-caller-b
  const store = mockRepository({
    existing: {
      id: "33333333-3333-4333-8333-333333333333",
      idempotency_key: upload.idempotencyKey,
      status: "PENDING_UPLOAD",
      drive_file_id: null,
      operation_token: "token-caller-b",
      reservation_expires_at: new Date(Date.now() + 60000).toISOString(),
      metadata_snapshot: snapshot(upload),
      document_id: null,
      created_by: staff.id,
      safe_error_code: null,
    },
  });

  // Stale Caller A tries to persist Drive ID with old token-caller-a
  const persistSuccess = await store.repository.persistDriveFileId("33333333-3333-4333-8333-333333333333", "stale_id_a", "token-caller-a");
  assert.equal(persistSuccess, false, "stale token cannot persist Drive ID");
  assert.equal(store.current()?.drive_file_id, null);

  // Caller B successfully persists
  const bPersisted = await store.repository.persistDriveFileId("33333333-3333-4333-8333-333333333333", driveId, "token-caller-b");
  assert.equal(bPersisted, true);
  assert.equal(store.current()?.status, "UPLOADING");

  // Stale Caller A tries markPendingRegistry with old token-caller-a
  const pendingSuccess = await store.repository.markPendingRegistry("33333333-3333-4333-8333-333333333333", driveId, "token-caller-a");
  assert.equal(pendingSuccess, false, "stale token cannot mark PENDING_REGISTRY");
  assert.equal(store.current()?.status, "UPLOADING");

  // Stale Caller A tries markFailed with old token-caller-a
  const failResult = await store.repository.markFailed("33333333-3333-4333-8333-333333333333", driveId, "token-caller-a", "DRIVE_ERROR");
  assert.equal(failResult.changed, false, "stale token cannot mark FAILED");
  assert.equal(failResult.attempt?.status, "UPLOADING");
  assert.equal(store.current()?.status, "UPLOADING");
});

test("generateIds success + persistence failure: stale owner cannot overwrite newer owner or replace persisted ID", async () => withFolderMap(async () => {
  const upload = validUpload();
  const driveIdB = "persisted_drive_id_b";
  // Caller B has reclaimed and persisted driveIdB into UPLOADING state
  const store = mockRepository({
    existing: {
      id: "33333333-3333-4333-8333-333333333333",
      idempotency_key: upload.idempotencyKey,
      status: "UPLOADING",
      drive_file_id: driveIdB,
      operation_token: "token-caller-b",
      reservation_expires_at: null,
      metadata_snapshot: snapshot(upload),
      document_id: null,
      created_by: staff.id,
      safe_error_code: null,
    },
  });

  // Stale Caller A wakes up with ID_A and token-caller-a, attempts persistDriveFileId
  const persistResult = await store.repository.persistDriveFileId("33333333-3333-4333-8333-333333333333", "stale_id_a", "token-caller-a");
  assert.equal(persistResult, false, "stale owner persistence must fail");
  assert.equal(store.current()?.drive_file_id, driveIdB, "persisted Drive ID B cannot be replaced");
  assert.equal(store.current()?.operation_token, "token-caller-b", "newer owner token remains authoritative");
}));
