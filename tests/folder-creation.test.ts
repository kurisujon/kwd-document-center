import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFolderHandler, createDocumentFolder, FolderCreationError } from "../src/lib/documents/folder-api.ts";
import { getExplicitAdminDriveFolderId } from "../src/lib/documents/drive-config.ts";
import { FolderValidationError, normalizeFolderName, validateFolderRequest } from "../src/lib/documents/folder-validation.ts";
import { createReservedFolder } from "../src/lib/google/drive-folder-operation.ts";
import { DriveServiceError } from "../src/lib/google/drive-types.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";

const admin: AuthorizedUser = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE" };
const staff: AuthorizedUser = { ...admin, role: "STAFF" };
const requestValue = { document_type: "BACTI TEST", filing_year: 2026, filing_subcategory: "", name: " September   Reports ", idempotency_key: "22222222-2222-4222-8222-222222222222" };

function folderRequest(body: unknown = requestValue, headers: HeadersInit = { origin: "http://localhost", "content-type": "application/json" }) {
  return new Request("http://localhost/api/folders", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("folder validation normalizes names and rejects path-like, control, reserved, overlong, and unsupported inputs", () => {
  assert.deepEqual(normalizeFolderName("  September   Reports  "), { name: "September Reports", normalizedName: "september reports" });
  assert.equal(normalizeFolderName("Résumé 部門 2026").name, "Résumé 部門 2026");
  assert.equal(normalizeFolderName("SEPTEMBER REPORTS").normalizedName, "september reports");
  for (const value of ["", "   ", ".", "..", ".hidden", "name.", "A/B", "A\\B", "A\nB", "A\tB", "A\u0000B", "!!!", "😀", "CON", "con", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9", "a".repeat(101)]) {
    assert.throws(() => normalizeFolderName(value), FolderValidationError, value);
  }
  assert.equal([...normalizeFolderName("a".repeat(100)).name].length, 100);
});

test("folder request validation is strict and accepts only logical metadata", () => {
  const valid = validateFolderRequest(requestValue);
  assert.equal(valid.name, "September Reports");
  assert.equal(valid.normalizedName, "september reports");
  for (const extra of ["drive_folder_id", "drive_parent_id", "parent_folder_id", "root_folder_id", "actor_id", "created_by", "user_id"]) {
    assert.throws(() => validateFolderRequest({ ...requestValue, [extra]: "attacker" }), FolderValidationError, extra);
  }
  assert.throws(() => validateFolderRequest({ ...requestValue, filing_year: null }), FolderValidationError);
  assert.throws(() => validateFolderRequest({ ...requestValue, filing_subcategory: "AGENDAS" }), FolderValidationError);
});

test("strict folder parent resolution uses only an explicit map entry and never root fallback", () => {
  const previousMap = process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP;
  const previousRoot = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = JSON.stringify({ "ADMIN|2026|BACTI TEST": "mappedParent_12345" });
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "rootFallback_12345";
  try {
    assert.deepEqual(getExplicitAdminDriveFolderId("BACTI TEST", 2026, ""), { key: "ADMIN|2026|BACTI TEST", folderId: "mappedParent_12345" });
    assert.throws(() => getExplicitAdminDriveFolderId("MEMORANDUM", 2026, ""));
  } finally {
    if (previousMap === undefined) delete process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP; else process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = previousMap;
    if (previousRoot === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID; else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = previousRoot;
  }
});

test("folder API is JSON-only, same-origin, and ACTIVE ADMIN-only", async () => {
  for (const authorization of [{ kind: "unauthenticated" }, { kind: "inactive" }, { kind: "not-authorized" }, { kind: "authorized", user: staff }] satisfies AuthorizationResult[]) {
    const handler = createFolderHandler({ getAuthorization: async () => authorization, validate: validateFolderRequest, resolveParent: () => ({ key: "ADMIN|2026|BACTI TEST", folderId: "mappedParent_12345" }), create: async () => ({ name: "September Reports", destination: "ADMIN|2026|BACTI TEST", created: true }) });
    assert.equal((await handler(folderRequest())).status, authorization.kind === "unauthenticated" ? 401 : 403);
  }
  const handler = createFolderHandler({ getAuthorization: async () => ({ kind: "authorized", user: admin }), validate: validateFolderRequest, resolveParent: () => ({ key: "ADMIN|2026|BACTI TEST", folderId: "mappedParent_12345" }), create: async () => ({ name: "September Reports", destination: "ADMIN|2026|BACTI TEST", created: true }) });
  const crossOrigin = await handler(folderRequest(requestValue, { origin: "https://attacker.example", "content-type": "application/json" }));
  const wrongType = await handler(folderRequest(requestValue, { origin: "http://localhost", "content-type": "text/plain" }));
  const malformed = await handler(folderRequest("{", { origin: "http://localhost", "content-type": "application/json" }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(wrongType.status, 400);
  assert.equal(malformed.status, 400);
});

test("folder API returns safe created and idempotent responses without provider identifiers", async () => {
  const handler = createFolderHandler({ getAuthorization: async () => ({ kind: "authorized", user: admin }), validate: validateFolderRequest, resolveParent: () => ({ key: "ADMIN|2026|BACTI TEST", folderId: "mappedParent_12345" }), create: async () => ({ name: "September Reports", destination: "ADMIN|2026|BACTI TEST", created: false }) });
  const response = await handler(folderRequest());
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /September Reports/);
  assert.doesNotMatch(text, /mappedParent|drive_folder_id|operation_token|created_by/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("folder service persists a generated ID before one exact provider create and finalizes", async () => {
  const calls: string[] = [];
  const repository = {
    async claim() { return { outcome: "CLAIMED" as const, folder_id: "folder-row", drive_folder_id: null, operation_token: "token" }; },
    async persistDriveId(...args: unknown[]) { calls.push(`persist:${args[3]}`); return true; },
    async finalize() { calls.push("finalize"); return true; },
    async fail() { calls.push("fail"); return true; },
  };
  const drive = {
    async generateId() { calls.push("generate"); return "reservedFolder_12345"; },
    async get() { calls.push("get"); return null; },
    async create(input: { id: string; parentId: string; name: string }) { calls.push(`create:${input.id}:${input.parentId}`); return { id: input.id, name: input.name, parents: [input.parentId], mimeType: "application/vnd.google-apps.folder", trashed: false }; },
  };
  const result = await createDocumentFolder({ actor: admin, idempotencyKey: requestValue.idempotency_key, logicalParentKey: "ADMIN|2026|BACTI TEST", driveParentId: "mappedParent_12345", name: "September Reports", normalizedName: "september reports", repository: repository as never, drive: drive as never });
  assert.deepEqual(result, { name: "September Reports", destination: "ADMIN|2026|BACTI TEST", created: true });
  assert.deepEqual(calls, ["generate", "persist:reservedFolder_12345", "get", "create:reservedFolder_12345:mappedParent_12345", "finalize"]);
});

test("retrying a persisted exact folder ID verifies it before creating and safe failures never finalize", async () => {
  let creates = 0;
  const repository = {
    async claim() { return { outcome: "CLAIMED" as const, folder_id: "folder-row", drive_folder_id: "reservedFolder_12345", operation_token: "token" }; },
    async persistDriveId() { throw new Error("must not persist another id"); }, async finalize() { return true; }, async fail() { return true; },
  };
  const drive = { async generateId() { throw new Error("must not generate"); }, async get() { return { id: "reservedFolder_12345", name: "September Reports", parents: ["mappedParent_12345"], mimeType: "application/vnd.google-apps.folder", trashed: false }; }, async create() { creates += 1; throw new Error("must not create"); } };
  await createDocumentFolder({ actor: admin, idempotencyKey: requestValue.idempotency_key, logicalParentKey: "ADMIN|2026|BACTI TEST", driveParentId: "mappedParent_12345", name: "September Reports", normalizedName: "september reports", repository: repository as never, drive: drive as never });
  assert.equal(creates, 0);
});

test("an absent persisted reserved ID is created once with that same ID and never regenerated", async () => {
  let createdId = "";
  const repository = { async claim() { return { outcome: "CLAIMED" as const, folder_id: "folder-row", drive_folder_id: "reservedFolder_12345", operation_token: "token" }; }, async persistDriveId() { throw new Error("must not replace reserved ID"); }, async finalize() { return true; }, async fail() { return true; } };
  const drive = { async generateId() { throw new Error("must not generate replacement ID"); }, async get() { return null; }, async create(input: { id: string; parentId: string; name: string }) { createdId = input.id; return { id: input.id, name: input.name, parents: [input.parentId], mimeType: "application/vnd.google-apps.folder", trashed: false }; } };
  await createDocumentFolder({ actor: admin, idempotencyKey: requestValue.idempotency_key, logicalParentKey: "ADMIN|2026|BACTI TEST", driveParentId: "mappedParent_12345", name: "September Reports", normalizedName: "september reports", repository: repository as never, drive: drive as never });
  assert.equal(createdId, "reservedFolder_12345");
});

test("ambiguous create uses exactly one targeted GET and succeeds only for exact expected metadata", async () => {
  const calls: unknown[] = [];
  const files = {
    async create(input: unknown) { calls.push(["create", input]); throw { response: { status: 503 } }; },
    async get(input: unknown) { calls.push(["get", input]); return { data: { id: "reservedFolder_12345", name: "September Reports", parents: ["mappedParent_12345"], mimeType: "application/vnd.google-apps.folder", trashed: false } }; },
  };
  const result = await createReservedFolder(files as never, { id: "reservedFolder_12345", parentId: "mappedParent_12345", name: "September Reports" });
  assert.equal(result.id, "reservedFolder_12345");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ["get", { fileId: "reservedFolder_12345", fields: "id,name,parents,mimeType,trashed", supportsAllDrives: true }]);
});

test("ambiguous create with GET 404 remains retryable and never allocates a replacement ID", async () => {
  const files = { async create() { throw { response: { status: 503 } }; }, async get() { throw { response: { status: 404 } }; } };
  await assert.rejects(() => createReservedFolder(files as never, { id: "reservedFolder_12345", parentId: "mappedParent_12345", name: "September Reports" }), (error: unknown) => error instanceof DriveServiceError && error.kind === "TRANSIENT");
  const calls: string[] = [];
  const repository = { async claim() { return { outcome: "CLAIMED" as const, folder_id: "row", drive_folder_id: "reservedFolder_12345", operation_token: "token" }; }, async persistDriveId() { throw new Error("replacement ID forbidden"); }, async finalize() { calls.push("finalize"); return true; }, async fail() { calls.push("fail"); return true; } };
  const drive = { async generateId() { throw new Error("replacement ID forbidden"); }, async get() { return null; }, async create() { throw new DriveServiceError("TRANSIENT"); } };
  await assert.rejects(() => createDocumentFolder({ actor: admin, idempotencyKey: requestValue.idempotency_key, logicalParentKey: "ADMIN|2026|BACTI TEST", driveParentId: "mappedParent_12345", name: "September Reports", normalizedName: "september reports", repository: repository as never, drive: drive as never }), FolderCreationError);
  assert.deepEqual(calls, ["fail"]);
});

test("inconsistent existing reserved metadata never finalizes the folder operation", async () => {
  const calls: string[] = [];
  const repository = { async claim() { return { outcome: "CLAIMED" as const, folder_id: "row", drive_folder_id: "reservedFolder_12345", operation_token: "token" }; }, async persistDriveId() { throw new Error("must not persist"); }, async finalize() { calls.push("finalize"); return true; }, async fail() { calls.push("fail"); return true; } };
  const drive = { async generateId() { throw new Error("must not generate"); }, async get() { return { id: "reservedFolder_12345", name: "Wrong", parents: ["otherParent_12345"], mimeType: "application/vnd.google-apps.folder", trashed: false }; }, async create() { throw new Error("must not create"); } };
  await assert.rejects(() => createDocumentFolder({ actor: admin, idempotencyKey: requestValue.idempotency_key, logicalParentKey: "ADMIN|2026|BACTI TEST", driveParentId: "mappedParent_12345", name: "September Reports", normalizedName: "september reports", repository: repository as never, drive: drive as never }), FolderCreationError);
  assert.deepEqual(calls, ["fail"]);
});

test("folder API returns safe duplicate, unmapped, provider, and registry failures", async () => {
  const base = { getAuthorization: async () => ({ kind: "authorized", user: admin } as AuthorizationResult), validate: validateFolderRequest, resolveParent: () => ({ key: "ADMIN|2026|BACTI TEST", folderId: "mappedParent_12345" }) };
  const duplicate = await createFolderHandler({ ...base, create: async () => { throw new FolderCreationError("FOLDER_EXISTS", 409, "A folder with this name already exists in the selected destination."); } })(folderRequest());
  assert.equal(duplicate.status, 409);
  assert.doesNotMatch(await duplicate.text(), /mappedParent|normalized_name|sql|stack/i);
  let providerCalled = false;
  const unmapped = await createFolderHandler({ ...base, resolveParent: () => { throw new Error("unmapped"); }, create: async () => { providerCalled = true; return { name: "x", destination: "x", created: true }; } })(folderRequest());
  assert.equal(unmapped.status, 503);
  assert.equal(providerCalled, false);
  for (const failure of [new FolderCreationError("DRIVE_ERROR", 503, "The folder could not be created. Please retry."), new Error("SQLSTATE provider diagnostics")]) {
    const response = await createFolderHandler({ ...base, create: async () => { throw failure; } })(folderRequest());
    assert.ok(response.status >= 500);
    assert.doesNotMatch(await response.text(), /SQLSTATE|provider diagnostics|refresh_token|mappedParent/i);
  }
});

test("Drive permission failure marks the exact operation token failed and never finalizes", async () => {
  const calls: unknown[][] = [];
  const repository = { async claim() { return { outcome: "CLAIMED" as const, folder_id: "row", drive_folder_id: "reservedFolder_12345", operation_token: "current-token" }; }, async persistDriveId() { throw new Error("must not replace"); }, async finalize() { calls.push(["finalize"]); return true; }, async fail(...args: unknown[]) { calls.push(["fail", ...args]); return true; } };
  const drive = { async generateId() { throw new Error("must not generate"); }, async get() { return null; }, async create() { throw new DriveServiceError("FORBIDDEN"); } };
  await assert.rejects(() => createDocumentFolder({ actor: admin, idempotencyKey: requestValue.idempotency_key, logicalParentKey: "ADMIN|2026|BACTI TEST", driveParentId: "mappedParent_12345", name: "September Reports", normalizedName: "september reports", repository: repository as never, drive: drive as never }), (error: unknown) => error instanceof FolderCreationError && error.status === 502);
  assert.deepEqual(calls, [["fail", "row", admin.id, "current-token", "DRIVE_PERMISSION"]]);
});

test("timeout folder service failure becomes a safe public 503 without provider details", async () => {
  const repository = { async claim() { return { outcome: "CLAIMED" as const, folder_id: "row", drive_folder_id: "reservedFolder_12345", operation_token: "token" }; }, async persistDriveId() { return true; }, async finalize() { return true; }, async fail() { return true; } };
  const drive = { async generateId() { throw new Error("must not generate"); }, async get() { return null; }, async create() { throw new DriveServiceError("TRANSIENT"); } };
  const handler = createFolderHandler({ getAuthorization: async () => ({ kind: "authorized", user: admin }), validate: validateFolderRequest, resolveParent: () => ({ key: "ADMIN|2026|BACTI TEST", folderId: "mappedParent_12345" }), create: (input) => createDocumentFolder({ ...input, repository: repository as never, drive: drive as never }) });
  const response = await handler(folderRequest());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /google|mappedParent|reservedFolder|operation_token|stack/i);
});

test("folder migration and provider boundary are strict, scoped, and service-role-only", async () => {
  const [migration, provider, operation] = await Promise.all([
    readFile(new URL("../supabase/migrations/20261001000000_add_document_folders.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/google/drive-folders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/google/drive-folder-operation.ts", import.meta.url), "utf8"),
  ]);
  for (const value of ["document_folders", "idempotency_key uuid not null unique", "unique (logical_parent_key, normalized_name)", "drive_folder_id text unique", "security definer", "set search_path = public, pg_catalog", "for update", "actor.role = 'ADMIN'", "actor.status = 'ACTIVE'"]) assert.match(migration, new RegExp(value.replace(/[()]/g, "\\$&"), "i"));
  assert.doesNotMatch(migration.split("create or replace function", 1)[0], /lease_expires_at\s*>\s*now\(\)/i);
  assert.match(migration, /revoke all on function public\.admin_claim_document_folder_creation[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.admin_finalize_document_folder_creation[\s\S]*to service_role/i);
  assert.match(operation, /mimeType: "application\/vnd\.google-apps\.folder"/);
  assert.match(provider, /files\.generateIds/);
  assert.match(operation, /files\.get/);
  assert.doesNotMatch(`${provider}\n${operation}`, /files\.list|files\.delete|permissions\.(?:create|update|delete)|files\.update/);
});
