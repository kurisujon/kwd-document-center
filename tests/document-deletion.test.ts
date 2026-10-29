import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDeleteDocumentHandler,
  createListTrashedDocumentsHandler,
  createPurgeDocumentHandler,
  createRestoreDocumentHandler,
} from "../src/lib/documents/deletion-api.ts";
import {
  DocumentDeletionError,
  deleteDocument,
  purgeDocument,
  restoreDocument,
} from "../src/lib/documents/delete-service.ts";
import { createDownloadDocumentHandler, createOpenDocumentHandler } from "../src/lib/documents/file-api.ts";
import { isDocumentId } from "../src/lib/documents/query.ts";
import { listDocuments } from "../src/lib/documents/repository.ts";
import { trashDriveFile, untrashDriveFile } from "../src/lib/google/drive-deletion.ts";
import { DriveServiceError } from "../src/lib/google/drive-types.ts";
import { driveOAuthScope } from "../src/lib/google/drive-oauth.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import type { DocumentRecord } from "../src/lib/documents/types.ts";

const id = "11111111-1111-4111-8111-111111111111";
const admin: AuthorizedUser = { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE" };
const staff: AuthorizedUser = { ...admin, role: "STAFF" };
const activeAdmin: AuthorizationResult = { kind: "authorized", user: admin };
const document: DocumentRecord = { document_id: id, document_type: "BACTI TEST", document_number: "DELETE-001", document_date: "2026-09-30", subject: "Delete test", persons_involved: null, drive_file_id: "driveFileId_12345", drive_url: null, file_name: "delete.pdf", file_type: "application/pdf", filing_year: 2026, filing_subcategory: null, status: "ACTIVE", deletion_state: "ACTIVE", created_by: admin.email, created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };

function purgeRepository(
  outcome: "CLAIMED" | "ALREADY_PURGED" | "NOT_DELETED" | "IN_PROGRESS" | "NOT_FOUND" = "CLAIMED",
  finalize = true,
) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  return {
    calls,
    value: {
      async claimPurge(...args: unknown[]) {
        calls.push({ name: "claimPurge", args });
        return {
          outcome,
          drive_file_id: outcome === "CLAIMED" ? document.drive_file_id : null,
          operation_token: outcome === "CLAIMED" ? "token" : null,
        };
      },
      async finalizePurge(...args: unknown[]) {
        calls.push({ name: "finalizePurge", args });
        return finalize;
      },
      async fail(...args: unknown[]) {
        calls.push({ name: "fail", args });
        return true;
      },
    },
  };
}

function providerError(status: number) {
  return { response: { status }, code: status };
}

function deletionDrive(update: () => Promise<{ data: { id?: string; trashed?: boolean } }>, get: () => Promise<{ data: { id?: string; trashed?: boolean } }> = async () => ({ data: {} })) {
  return (fileId: string) => trashDriveFile({ update, get } as never, fileId);
}

test("delete API enforces authentication, ACTIVE ADMIN, origin, UUID, and server-derived actor", async () => {
  for (const authorization of [
    { kind: "unauthenticated" }, { kind: "inactive" }, { kind: "not-authorized" }, { kind: "authorized", user: staff },
  ] satisfies AuthorizationResult[]) {
    let invoked = false;
    const handler = createDeleteDocumentHandler({ getAuthorization: async () => authorization, isDocumentId, deleteDocument: async () => { invoked = true; return { deleted: true, reused: false }; } });
    const response = await handler(new Request(`http://localhost/api/documents/${id}`, { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal(invoked, false);
  }
  const handler = createDeleteDocumentHandler({ getAuthorization: async () => activeAdmin, isDocumentId, deleteDocument: async () => ({ deleted: true, reused: false }) });
  assert.equal((await handler(new Request(`http://localhost/api/documents/${id}`, { method: "DELETE", headers: { origin: "https://attacker.example" } }), { params: Promise.resolve({ id }) })).status, 403);
  assert.equal((await handler(new Request("http://localhost/api/documents/not-a-uuid", { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id: "not-a-uuid" }) })).status, 400);
});

test("soft delete marks deletion_state = DELETED in the database without touching Google Drive", async () => {
  const calls: Array<{ documentId: string; actorId: string }> = [];
  const result = await deleteDocument({
    documentId: id,
    actor: admin,
    repository: {
      async softDelete(documentId, actorId) {
        calls.push({ documentId, actorId });
        return { outcome: "DELETED" as const };
      },
    },
  });
  assert.deepEqual(result, { deleted: true, reused: false });
  assert.deepEqual(calls, [{ documentId: id, actorId: admin.id }]);

  const alreadyDeleted = await deleteDocument({
    documentId: id,
    actor: admin,
    repository: {
      async softDelete() {
        return { outcome: "ALREADY_DELETED" as const };
      },
    },
  });
  assert.deepEqual(alreadyDeleted, { deleted: true, reused: true });
});

test("restore returns DELETED records to ACTIVE, untrashes legacy Drive-trashed files, and rejects purged records", async () => {
  const restored = await restoreDocument({
    documentId: id,
    actor: admin,
    repository: {
      async prepareRestore() {
        return { outcome: "RESTORED" as const, drive_file_id: document.drive_file_id, needs_drive_untrash: false };
      },
      async completeRestore() {
        throw new Error("should not be called when needs_drive_untrash is false");
      },
    },
  });
  assert.deepEqual(restored, { restored: true, reused: false });

  // Legacy trashed record untrashes in Drive first
  let untrashedId = "";
  let completedRestore = false;
  const legacyRestored = await restoreDocument({
    documentId: id,
    actor: admin,
    repository: {
      async prepareRestore() {
        return { outcome: "NEEDS_DRIVE_UNTRASH" as const, drive_file_id: document.drive_file_id, needs_drive_untrash: true };
      },
      async completeRestore() {
        completedRestore = true;
        return true;
      },
    },
    drive: {
      async trash() {
        return { disposition: "TRASHED" as const };
      },
      async untrash(fileId) {
        untrashedId = fileId;
        return { disposition: "UNTRASHED" as const };
      },
    },
  });
  assert.deepEqual(legacyRestored, { restored: true, reused: false });
  assert.equal(untrashedId, document.drive_file_id);
  assert.equal(completedRestore, true);

  // Purged records cannot be restored
  await assert.rejects(
    () =>
      restoreDocument({
        documentId: id,
        actor: admin,
        repository: {
          async prepareRestore() {
            return { outcome: "ALREADY_PURGED" as const, drive_file_id: document.drive_file_id, needs_drive_untrash: false };
          },
          async completeRestore() {
            return false;
          },
        },
      }),
    (err: unknown) => err instanceof DocumentDeletionError && err.code === "ALREADY_PURGED" && err.status === 409,
  );
});

test("Restore, Trash list, and Purge API handlers enforce ACTIVE ADMIN, same-origin, and reason validation", async () => {
  const trashListHandler = createListTrashedDocumentsHandler({
    getAuthorization: async () => ({ kind: "authorized", user: staff }),
    listTrashedDocuments: async () => [],
  });
  assert.equal((await trashListHandler()).status, 403);

  const restoreHandler = createRestoreDocumentHandler({
    getAuthorization: async () => activeAdmin,
    isDocumentId,
    restoreDocument: async () => ({ restored: true, reused: false }),
  });
  const restoreRes = await restoreHandler(
    new Request(`http://localhost/api/documents/${id}/restore`, {
      method: "POST",
      headers: { origin: "http://localhost" },
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(restoreRes.status, 200);

  let capturedReason = "";
  const purgeHandler = createPurgeDocumentHandler({
    getAuthorization: async () => activeAdmin,
    isDocumentId,
    purgeDocument: async ({ reason }) => {
      capturedReason = reason;
      return { purged: true, reused: false };
    },
  });

  // Missing reason rejected with 400
  const emptyReasonRes = await purgeHandler(
    new Request(`http://localhost/api/documents/${id}/purge`, {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(emptyReasonRes.status, 400);

  const validPurgeRes = await purgeHandler(
    new Request(`http://localhost/api/documents/${id}/purge`, {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Duplicate upload confirmed by records officer" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(validPurgeRes.status, 200);
  assert.equal(capturedReason, "Duplicate upload confirmed by records officer");
});

test("purge uses only the claimed stored Drive ID, requires a reason, and finalizes successful or absent Drive state", async () => {
  for (const disposition of ["TRASHED", "ABSENT"] as const) {
    const store = purgeRepository();
    let target = "";
    const result = await purgeDocument({
      documentId: id,
      actor: admin,
      reason: "Retention period expired",
      repository: store.value as never,
      drive: { async trash(driveId: string) { target = driveId; return { disposition }; } },
    });
    assert.deepEqual(result, { purged: true, reused: false });
    assert.equal(target, document.drive_file_id);
    assert.equal(store.calls.filter((call) => call.name === "finalizePurge").length, 1);
    assert.equal(store.calls.find((call) => call.name === "finalizePurge")!.args[3], disposition === "TRASHED");
    assert.equal(store.calls.find((call) => call.name === "finalizePurge")!.args[4], "Retention period expired");
  }
});

test("purge is idempotent and provider failures do not finalize a record", async () => {
  const alreadyPurged = await purgeDocument({
    documentId: id,
    actor: admin,
    reason: "Duplicate",
    repository: purgeRepository("ALREADY_PURGED").value as never,
    drive: { async trash() { throw new Error("must not call Drive"); } },
  });
  assert.deepEqual(alreadyPurged, { purged: true, reused: true });

  const store = purgeRepository();
  await assert.rejects(
    () =>
      purgeDocument({
        documentId: id,
        actor: admin,
        reason: "Duplicate",
        repository: store.value as never,
        drive: { async trash() { throw new Error("provider diagnostics"); } },
      }),
    (error: unknown) => error instanceof DocumentDeletionError && error.code === "DRIVE_ERROR",
  );
  assert.equal(store.calls.some((call) => call.name === "finalizePurge"), false);
  assert.equal(store.calls.some((call) => call.name === "fail"), true);
  await assert.rejects(
    () =>
      purgeDocument({
        documentId: id,
        actor: admin,
        reason: "Duplicate",
        repository: purgeRepository("CLAIMED", false).value as never,
        drive: { async trash() { return { disposition: "TRASHED" as const }; } },
      }),
    (error: unknown) => error instanceof DocumentDeletionError && error.code === "DELETE_IN_PROGRESS",
  );
});

test("only an exact current claim token can finalize or fail a purge", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const store = {
    async claimPurge() { return { outcome: "CLAIMED" as const, drive_file_id: document.drive_file_id, operation_token: "current-token" }; },
    async finalizePurge(...args: unknown[]) { calls.push({ name: "finalizePurge", args }); return true; },
    async fail(...args: unknown[]) { calls.push({ name: "fail", args }); return true; },
  };
  await purgeDocument({ documentId: id, actor: admin, reason: "Duplicate", repository: store as never, drive: { async trash() { return { disposition: "TRASHED" as const }; } } });
  assert.equal(calls[0].args[2], "current-token");
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  assert.match(migration, /deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token/g);
});

test("active claims conflict while failed or expired claims can be retried through the locked RPC", async () => {
  await assert.rejects(
    () => purgeDocument({ documentId: id, actor: admin, reason: "Duplicate", repository: purgeRepository("IN_PROGRESS").value as never, drive: { async trash() { throw new Error("must not call"); } } }),
    (error: unknown) => error instanceof DocumentDeletionError && error.status === 409,
  );
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  assert.match(migration, /DELETE_PENDING' and target\.delete_lease_expires_at > now\(\)/);
  assert.match(migration, /select \* into target from public\.documents where document_id = p_document_id for update/i);
  assert.match(migration, /update public\.documents set deletion_state = 'DELETE_PENDING'/i);
});

test("expired deletion leases are reclaimed with a replacement ownership token", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  const claim = migration.match(/create or replace function public\.admin_claim_document_deletion\([\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(claim, /DELETE_PENDING' and target\.delete_lease_expires_at > now\(\)[\s\S]*return query select 'IN_PROGRESS'/i);
  assert.match(claim, /update public\.documents set deletion_state = 'DELETE_PENDING', delete_started_at = now\(\), delete_operation_token = p_operation_token,[\s\S]*delete_lease_expires_at = now\(\) \+ pg_catalog\.make_interval/i);
  assert.match(claim, /return query select 'CLAIMED'::text, target\.drive_file_id, p_operation_token/i);
});

test("stale deletion tokens cannot finalize or mark failure for a newer claim", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  const finalize = migration.match(/create or replace function public\.admin_finalize_document_deletion\([\s\S]*?\$\$;/i)?.[0] ?? "";
  const failure = migration.match(/create or replace function public\.admin_mark_document_delete_failed\([\s\S]*?\$\$;/i)?.[0] ?? "";
  const tokenA = "old-operation-token";
  const tokenB = "current-operation-token";
  assert.notEqual(tokenA, tokenB);
  assert.match(finalize, /where document_id = p_document_id and deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token/i);
  assert.match(failure, /where document_id = p_document_id and deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token/i);
  assert.doesNotMatch(finalize, /where document_id = p_document_id\s*;/i);
  assert.doesNotMatch(failure, /where document_id = p_document_id\s*;/i);
});

test("delete API returns safe failures without raw provider diagnostics", async () => {
  const handler = createDeleteDocumentHandler({
    getAuthorization: async () => activeAdmin,
    isDocumentId,
    deleteDocument: async () => { throw new DocumentDeletionError("REGISTRY_ERROR", 503, "Document deletion is temporarily unavailable."); },
  });
  const response = await handler(new Request(`http://localhost/api/documents/${id}`, { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.doesNotMatch(body, /provider diagnostics|refresh_token|access_token/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("deleted records are rejected before Open or Download calls Drive", async () => {
  let driveCalls = 0;
  const deleted = { ...document, deletion_state: "DELETED" as const };
  const dependencies = { getAuthorization: async () => activeAdmin, isDocumentId, getDocument: async () => deleted, drive: {
    async generateFileId() { return "unused"; }, async upload() { throw new Error("unused"); },
    async getMetadata() { driveCalls += 1; throw new Error("must not call"); }, async download() { driveCalls += 1; throw new Error("must not call"); },
  } };
  const context = { params: Promise.resolve({ id }) };
  assert.equal((await createOpenDocumentHandler(dependencies)(new Request("http://localhost"), context)).status, 404);
  assert.equal((await createDownloadDocumentHandler(dependencies)(new Request("http://localhost"), context)).status, 404);
  assert.equal(driveCalls, 0);
});

test("normal registry listing returns only ACTIVE documents", async () => {
  const records = [
    { ...document, deletion_state: "ACTIVE" as const },
    { ...document, document_id: "33333333-3333-4333-8333-333333333333", deletion_state: "DELETE_PENDING" as const },
    { ...document, document_id: "44444444-4444-4444-8444-444444444444", deletion_state: "DELETE_FAILED" as const },
    { ...document, document_id: "55555555-5555-4555-8555-555555555555", deletion_state: "DELETED" as const },
  ];
  let activeOnly = false;
  const request = {
    select: () => request,
    eq: (column: string, value: string) => { if (column === "deletion_state" && value === "ACTIVE") activeOnly = true; return request; },
    order: () => request,
    range: async () => ({ data: records.filter((row) => !activeOnly || row.deletion_state === "ACTIVE"), error: null, count: 1 }),
  };
  const result = await listDocuments({ from: () => request } as never, { page: 1, pageSize: 25, sortBy: "created_at", sortOrder: "desc" });
  assert.deepEqual(result.documents.map((row) => row.document_id), [id]);
  assert.equal(activeOnly, true);
});

test("Drive Trash and Untrash treat already-trashed or untrashed files as idempotent results", async () => {
  let updates = 0;
  const trash = deletionDrive(async () => { updates += 1; return { data: { id: document.drive_file_id!, trashed: true } }; });
  assert.deepEqual(await trash(document.drive_file_id!), { disposition: "TRASHED" });
  assert.equal(updates, 1);

  const untrash = (fileId: string) =>
    untrashDriveFile(
      {
        update: async () => ({ data: { id: fileId, trashed: false } }),
        get: async () => ({ data: {} }),
      } as never,
      fileId,
    );
  assert.deepEqual(await untrash(document.drive_file_id!), { disposition: "UNTRASHED" });
});

test("Drive Trash turns a provider 404 into an absent result and a 403 into a safe permission failure", async () => {
  const absent = deletionDrive(async () => { throw providerError(404); });
  assert.deepEqual(await absent(document.drive_file_id!), { disposition: "ABSENT" });

  const forbidden = deletionDrive(async () => { throw providerError(403); });
  await assert.rejects(() => forbidden(document.drive_file_id!), (error: unknown) => error instanceof DriveServiceError && error.kind === "FORBIDDEN");
});

test("ambiguous Drive Trash results use one bounded metadata check before finalization", async () => {
  for (const [metadata, expected] of [
    [async () => ({ data: { id: document.drive_file_id!, trashed: true } }), "TRASHED"],
    [async () => { throw providerError(404); }, "ABSENT"],
  ] as const) {
    let updates = 0;
    let reads = 0;
    const trash = deletionDrive(async () => { updates += 1; throw providerError(503); }, async () => { reads += 1; return metadata(); });
    assert.deepEqual(await trash(document.drive_file_id!), { disposition: expected });
    assert.equal(updates, 2);
    assert.equal(reads, 1);
  }
});

test("unresolved transient Drive Trash result is retryable and never finalizes purge", async () => {
  let updates = 0;
  let reads = 0;
  const trash = deletionDrive(async () => { updates += 1; throw providerError(503); }, async () => { reads += 1; throw providerError(503); });
  await assert.rejects(() => trash(document.drive_file_id!), (error: unknown) => error instanceof DriveServiceError && error.kind === "TRANSIENT");
  assert.equal(updates, 2);
  assert.equal(reads, 1);

  const store = purgeRepository();
  await assert.rejects(() => purgeDocument({ documentId: id, actor: admin, reason: "Duplicate", repository: store.value as never, drive: { trash } }), (error: unknown) => error instanceof DocumentDeletionError && error.status === 503);
  assert.equal(store.calls.some((call) => call.name === "finalizePurge"), false);
  assert.equal(store.calls.filter((call) => call.name === "fail").length, 1);
});

test("permission denial records a safe retryable failure without finalizing purge", async () => {
  const store = purgeRepository();
  await assert.rejects(() => purgeDocument({
    documentId: id,
    actor: admin,
    reason: "Duplicate",
    repository: store.value as never,
    drive: { trash: deletionDrive(async () => { throw providerError(403); }) },
  }), (error: unknown) => error instanceof DocumentDeletionError && error.status === 502);
  assert.equal(store.calls.some((call) => call.name === "finalizePurge"), false);
  assert.deepEqual(store.calls.find((call) => call.name === "fail")!.args.slice(3), ["DRIVE_PERMISSION"]);
});

test("registry finalization failure after Drive Trash is recoverable using the same stored Drive ID", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  let finalized = false;
  let firstFinalize = true;
  const store = {
    async claimPurge(_documentId: string, _actorId: string, token: string) { calls.push({ name: "claimPurge", args: [token] }); return { outcome: "CLAIMED" as const, drive_file_id: document.drive_file_id, operation_token: token }; },
    async finalizePurge(...args: unknown[]) { calls.push({ name: "finalizePurge", args }); if (firstFinalize) { firstFinalize = false; throw new Error("registry unavailable"); } finalized = true; return true; },
    async fail(...args: unknown[]) { calls.push({ name: "fail", args }); return true; },
  };
  const targets: string[] = [];
  const drive = { async trash(target: string) { targets.push(target); return { disposition: "TRASHED" as const }; } };
  await assert.rejects(() => purgeDocument({ documentId: id, actor: admin, reason: "Duplicate", repository: store as never, drive }), (error: unknown) => error instanceof DocumentDeletionError && error.code === "REGISTRY_ERROR");
  assert.equal(finalized, false);
  const recovered = await purgeDocument({ documentId: id, actor: admin, reason: "Duplicate", repository: store as never, drive });
  assert.deepEqual(recovered, { purged: true, reused: false });
  assert.equal(finalized, true);
  assert.deepEqual(targets, [document.drive_file_id, document.drive_file_id]);
  assert.equal(calls.filter((call) => call.name === "fail").length, 0);
});

test("deletion provider code contains no permanent delete, list discovery, or permission writes", async () => {
  const source = await readFile(new URL("../src/lib/google/drive-deletion.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /files\.delete\s*\(/);
  assert.doesNotMatch(source, /files\.list\s*\(/);
  assert.doesNotMatch(source, /permissions\.(?:create|update|delete)\s*\(/);
  assert.match(source, /files\.update\(\{[\s\S]*requestBody:\s*\{\s*trashed:\s*true\s*\}/);
  assert.equal(driveOAuthScope, "https://www.googleapis.com/auth/drive.file");
});

test("deletion and ADR-006 trash/restore/purge migrations define complete lifecycle and service-role-only RPC contracts", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  for (const column of ["deletion_state", "delete_started_at", "delete_operation_token", "delete_lease_expires_at", "delete_error_category", "deleted_at", "deleted_by", "drive_trashed_at"]) assert.match(migration, new RegExp(`add column ${column}`, "i"));
  const tableDefinition = migration.split("create or replace function", 1)[0];
  for (const state of ["ACTIVE", "DELETE_PENDING", "DELETE_FAILED", "DELETED"]) assert.match(tableDefinition, new RegExp(`deletion_state = '${state}'`, "i"));
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.documents\b/i);
  assert.doesNotMatch(migration, /\btruncate\s+(?:table\s+)?public\.documents\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+table\s+public\.documents\b/i);
  assert.doesNotMatch(migration, /grant execute on function public\.[^;]+\s+to authenticated/i);

  const trashMigration = await readFile(new URL("../supabase/migrations/20261029020000_add_trash_restore_and_purge.sql", import.meta.url), "utf8");
  for (const column of ["purged_at", "purged_by", "purge_reason"]) {
    assert.match(trashMigration, new RegExp(`add column ${column}`, "i"));
  }
  for (const fn of [
    "admin_soft_delete_document",
    "admin_list_trashed_documents",
    "admin_prepare_document_restore",
    "admin_complete_document_restore",
    "admin_claim_document_purge",
    "admin_finalize_document_purge",
  ]) {
    assert.match(trashMigration, new RegExp(`create or replace function public\\.${fn}\\(`, "i"));
    assert.match(trashMigration, new RegExp(`revoke all on function public\\.${fn}\\([^;]+from public, anon, authenticated`, "i"));
    assert.match(trashMigration, new RegExp(`grant execute on function public\\.${fn}\\([^;]+to service_role`, "i"));
  }

  const adr = await readFile(new URL("../docs/architecture/ADR-006-soft-delete-restore-purge.md", import.meta.url), "utf8");
  assert.match(adr, /Soft Delete/i);
  assert.match(adr, /Restore/i);
  assert.match(adr, /Admin Purge/i);
});
