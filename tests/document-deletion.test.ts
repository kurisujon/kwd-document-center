import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDeleteDocumentHandler } from "../src/lib/documents/deletion-api.ts";
import { DocumentDeletionError, deleteDocument } from "../src/lib/documents/delete-service.ts";
import { createDownloadDocumentHandler, createOpenDocumentHandler } from "../src/lib/documents/file-api.ts";
import { isDocumentId } from "../src/lib/documents/query.ts";
import { listDocuments } from "../src/lib/documents/repository.ts";
import { trashDriveFile } from "../src/lib/google/drive-deletion.ts";
import { DriveServiceError } from "../src/lib/google/drive-types.ts";
import { driveOAuthScope } from "../src/lib/google/drive-oauth.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import type { DocumentRecord } from "../src/lib/documents/types.ts";

const id = "11111111-1111-4111-8111-111111111111";
const admin: AuthorizedUser = { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE" };
const staff: AuthorizedUser = { ...admin, role: "STAFF" };
const activeAdmin: AuthorizationResult = { kind: "authorized", user: admin };
const document: DocumentRecord = { document_id: id, document_type: "BACTI TEST", document_number: "DELETE-001", document_date: "2026-09-30", subject: "Delete test", persons_involved: null, drive_file_id: "driveFileId_12345", drive_url: null, file_name: "delete.pdf", file_type: "application/pdf", filing_year: 2026, filing_subcategory: null, status: "ACTIVE", deletion_state: "ACTIVE", created_by: admin.email, created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };

function repository(outcome: "CLAIMED" | "ALREADY_DELETED" | "IN_PROGRESS" | "NOT_FOUND" = "CLAIMED", finalize = true) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  return {
    calls,
    value: {
      async claim(...args: unknown[]) { calls.push({ name: "claim", args }); return { outcome, drive_file_id: outcome === "CLAIMED" ? document.drive_file_id : null, operation_token: outcome === "CLAIMED" ? "token" : null }; },
      async finalize(...args: unknown[]) { calls.push({ name: "finalize", args }); return finalize; },
      async fail(...args: unknown[]) { calls.push({ name: "fail", args }); return true; },
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

test("deletion uses only the claimed stored Drive ID and finalizes successful or absent Drive state", async () => {
  for (const disposition of ["TRASHED", "ABSENT"] as const) {
    const store = repository();
    let target = "";
    const result = await deleteDocument({ documentId: id, actor: admin, repository: store.value as never, drive: { async trash(driveId: string) { target = driveId; return { disposition }; } } });
    assert.deepEqual(result, { deleted: true, reused: false });
    assert.equal(target, document.drive_file_id);
    assert.equal(store.calls.filter((call) => call.name === "finalize").length, 1);
    assert.equal((store.calls.find((call) => call.name === "finalize")!.args[3]), disposition === "TRASHED");
  }
});

test("deletion is idempotent and provider failures do not finalize a record", async () => {
  const alreadyDeleted = await deleteDocument({ documentId: id, actor: admin, repository: repository("ALREADY_DELETED").value as never, drive: { async trash() { throw new Error("must not call Drive"); } } });
  assert.deepEqual(alreadyDeleted, { deleted: true, reused: true });

  const store = repository();
  await assert.rejects(() => deleteDocument({ documentId: id, actor: admin, repository: store.value as never, drive: { async trash() { throw new Error("provider diagnostics"); } } }), (error: unknown) => error instanceof DocumentDeletionError && error.code === "DRIVE_ERROR");
  assert.equal(store.calls.some((call) => call.name === "finalize"), false);
  assert.equal(store.calls.some((call) => call.name === "fail"), true);
  await assert.rejects(() => deleteDocument({ documentId: id, actor: admin, repository: repository("CLAIMED", false).value as never, drive: { async trash() { return { disposition: "TRASHED" as const }; } } }), (error: unknown) => error instanceof DocumentDeletionError && error.code === "DELETE_IN_PROGRESS");
});

test("only an exact current claim token can finalize or fail a deletion", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const store = {
    async claim() { return { outcome: "CLAIMED" as const, drive_file_id: document.drive_file_id, operation_token: "current-token" }; },
    async finalize(...args: unknown[]) { calls.push({ name: "finalize", args }); return true; },
    async fail(...args: unknown[]) { calls.push({ name: "fail", args }); return true; },
  };
  await deleteDocument({ documentId: id, actor: admin, repository: store as never, drive: { async trash() { return { disposition: "TRASHED" as const }; } } });
  assert.equal(calls[0].args[2], "current-token");
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  assert.match(migration, /deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token/g);
});

test("active claims conflict while failed or expired claims can be retried through the locked RPC", async () => {
  await assert.rejects(
    () => deleteDocument({ documentId: id, actor: admin, repository: repository("IN_PROGRESS").value as never, drive: { async trash() { throw new Error("must not call"); } } }),
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

test("delete API returns safe provider failures without raw provider diagnostics", async () => {
  const handler = createDeleteDocumentHandler({
    getAuthorization: async () => activeAdmin,
    isDocumentId,
    deleteDocument: async () => { throw new DocumentDeletionError("DRIVE_ERROR", 502, "The document could not be moved to Google Drive Trash. Please retry."); },
  });
  const response = await handler(new Request(`http://localhost/api/documents/${id}`, { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 502);
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

test("Drive Trash treats an already-trashed file as a successful idempotent result", async () => {
  let updates = 0;
  const trash = deletionDrive(async () => { updates += 1; return { data: { id: document.drive_file_id!, trashed: true } }; });
  assert.deepEqual(await trash(document.drive_file_id!), { disposition: "TRASHED" });
  assert.equal(updates, 1);
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

test("unresolved transient Drive Trash result is retryable and never finalizes deletion", async () => {
  let updates = 0;
  let reads = 0;
  const trash = deletionDrive(async () => { updates += 1; throw providerError(503); }, async () => { reads += 1; throw providerError(503); });
  await assert.rejects(() => trash(document.drive_file_id!), (error: unknown) => error instanceof DriveServiceError && error.kind === "TRANSIENT");
  assert.equal(updates, 2);
  assert.equal(reads, 1);

  const store = repository();
  await assert.rejects(() => deleteDocument({ documentId: id, actor: admin, repository: store.value as never, drive: { trash } }), (error: unknown) => error instanceof DocumentDeletionError && error.status === 503);
  assert.equal(store.calls.some((call) => call.name === "finalize"), false);
  assert.equal(store.calls.filter((call) => call.name === "fail").length, 1);
});

test("permission denial records a safe retryable failure without finalizing", async () => {
  const store = repository();
  await assert.rejects(() => deleteDocument({
    documentId: id,
    actor: admin,
    repository: store.value as never,
    drive: { trash: deletionDrive(async () => { throw providerError(403); }) },
  }), (error: unknown) => error instanceof DocumentDeletionError && error.status === 502);
  assert.equal(store.calls.some((call) => call.name === "finalize"), false);
  assert.deepEqual(store.calls.find((call) => call.name === "fail")!.args.slice(3), ["DRIVE_PERMISSION"]);
});

test("registry finalization failure after Drive Trash is recoverable using the same stored Drive ID", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  let finalized = false;
  let firstFinalize = true;
  const store = {
    async claim(_documentId: string, _actorId: string, token: string) { calls.push({ name: "claim", args: [token] }); return { outcome: "CLAIMED" as const, drive_file_id: document.drive_file_id, operation_token: token }; },
    async finalize(...args: unknown[]) { calls.push({ name: "finalize", args }); if (firstFinalize) { firstFinalize = false; throw new Error("registry unavailable"); } finalized = true; return true; },
    async fail(...args: unknown[]) { calls.push({ name: "fail", args }); return true; },
  };
  const targets: string[] = [];
  const drive = { async trash(target: string) { targets.push(target); return { disposition: "TRASHED" as const }; } };
  await assert.rejects(() => deleteDocument({ documentId: id, actor: admin, repository: store as never, drive }), (error: unknown) => error instanceof DocumentDeletionError && error.code === "REGISTRY_ERROR");
  assert.equal(finalized, false);
  const recovered = await deleteDocument({ documentId: id, actor: admin, repository: store as never, drive });
  assert.deepEqual(recovered, { deleted: true, reused: false });
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

test("deletion migration defines complete lifecycle and service-role-only RPC contracts", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260930000000_add_document_deletion_state.sql", import.meta.url), "utf8");
  for (const column of ["deletion_state", "delete_started_at", "delete_operation_token", "delete_lease_expires_at", "delete_error_category", "deleted_at", "deleted_by", "drive_trashed_at"]) assert.match(migration, new RegExp(`add column ${column}`, "i"));
  const tableDefinition = migration.split("create or replace function", 1)[0];
  for (const state of ["ACTIVE", "DELETE_PENDING", "DELETE_FAILED", "DELETED"]) assert.match(tableDefinition, new RegExp(`deletion_state = '${state}'`, "i"));
  assert.match(tableDefinition, /DELETE_PENDING[\s\S]*delete_started_at is not null[\s\S]*delete_operation_token is not null[\s\S]*delete_lease_expires_at is not null/i);
  assert.match(tableDefinition, /DELETE_FAILED[\s\S]*delete_operation_token is null[\s\S]*delete_lease_expires_at is null[\s\S]*delete_error_category is not null/i);
  assert.match(tableDefinition, /DELETED[\s\S]*deleted_at is not null[\s\S]*deleted_by is not null/i);
  assert.doesNotMatch(tableDefinition, /delete_lease_expires_at\s*>\s*now\(\)/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.documents\b/i);
  assert.doesNotMatch(migration, /\btruncate\s+(?:table\s+)?public\.documents\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+table\s+public\.documents\b/i);
  assert.doesNotMatch(migration, /grant execute on function public\.[^;]+\s+to authenticated/i);

  const blocks = new Map<string, string>();
  for (const fn of ["admin_claim_document_deletion", "admin_finalize_document_deletion", "admin_mark_document_delete_failed"]) {
    const match = migration.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`, "i"));
    assert.ok(match, `Missing ${fn}`);
    const block = match[0];
    blocks.set(fn, block);
    assert.match(block, /security definer/i);
    assert.match(block, /set search_path = public, pg_catalog/i);
    assert.match(block, /actor\.role = 'ADMIN'[\s\S]*actor\.status = 'ACTIVE'/i);
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^;]+from public, anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\([^;]+to service_role`, "i"));
  }
  const claim = blocks.get("admin_claim_document_deletion")!;
  assert.match(claim, /from public\.documents where document_id = p_document_id for update/i);
  assert.match(claim, /DELETE_PENDING' and target\.delete_lease_expires_at > now\(\)[\s\S]*IN_PROGRESS/i);
  assert.match(claim, /update public\.documents set deletion_state = 'DELETE_PENDING'[\s\S]*delete_operation_token = p_operation_token[\s\S]*delete_lease_expires_at = now\(\)/i);

  const finalize = blocks.get("admin_finalize_document_deletion")!;
  assert.match(finalize, /where document_id = p_document_id and deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token/i);
  const failure = blocks.get("admin_mark_document_delete_failed")!;
  assert.match(failure, /where document_id = p_document_id and deletion_state = 'DELETE_PENDING' and delete_operation_token = p_operation_token/i);
});
