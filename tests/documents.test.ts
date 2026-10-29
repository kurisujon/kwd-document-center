import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGetDocumentHandler, createListDocumentsHandler } from "../src/lib/documents/api.ts";
import { createPatchDocumentConfidentialityHandler } from "../src/lib/documents/confidentiality-api.ts";
import { createDownloadDocumentHandler, createOpenDocumentHandler } from "../src/lib/documents/file-api.ts";
import { canReadDocument, hasMinimumRole } from "../src/lib/auth/permissions.ts";
import { isDocumentId, parseDocumentListQuery } from "../src/lib/documents/query.ts";
import { getDocumentById, listDocuments, listDocumentTypes } from "../src/lib/documents/repository.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import type { DocumentRecord, PaginatedDocuments } from "../src/lib/documents/types.ts";

const document: DocumentRecord = {
  document_id: "2e0e9825-98bb-4f78-9875-766e0af3516a",
  document_type: "Memorandum",
  document_number: "2026-001",
  document_date: "2026-09-01",
  subject: "Water rate adjustment",
  persons_involved: "KWD Board",
  drive_file_id: null,
  drive_url: null,
  file_name: null,
  file_type: null,
  filing_year: null,
  filing_subcategory: null,
  status: "ACTIVE",
  created_by: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

test("document list queries use the documented defaults", () => {
  const result = parseDocumentListQuery({});
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data, { page: 1, pageSize: 25, sortBy: "created_at", sortOrder: "desc" });
  }
});

test("document list queries preserve search and document type filters", () => {
  const result = parseDocumentListQuery({ q: "water rate", type: "Memorandum" });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.q, "water rate");
    assert.equal(result.data.type, "Memorandum");
  }
});

test("document list queries validate date filters and their range", () => {
  for (const params of [{ dateFrom: "not-a-date" }, { dateFrom: "2026-09-02", dateTo: "2026-09-01" }]) {
    const result = parseDocumentListQuery(params);
    assert.equal(result.success, false);
  }

  const valid = parseDocumentListQuery({ dateFrom: "2026-09-01", dateTo: "2026-09-30" });
  assert.equal(valid.success, true);
});

test("document list queries accept only real Gregorian calendar dates", () => {
  for (const date of ["2026-02-28", "2024-02-29", "2026-04-30"]) {
    assert.equal(parseDocumentListQuery({ dateFrom: date }).success, true, `Accepted: ${date}`);
  }
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00"]) {
    assert.equal(parseDocumentListQuery({ dateFrom: date }).success, false, `Rejected: ${date}`);
  }
});

test("document list queries allow only documented sort fields and directions", () => {
  const ascending = parseDocumentListQuery({ sortBy: "document_date", sortOrder: "asc" });
  assert.equal(ascending.success, true);
  if (ascending.success) assert.equal(ascending.data.sortOrder, "asc");

  const descending = parseDocumentListQuery({ sortBy: "subject", sortOrder: "desc" });
  assert.equal(descending.success, true);
  if (descending.success) assert.equal(descending.data.sortOrder, "desc");

  assert.equal(parseDocumentListQuery({ sortBy: "random_column" }).success, false);
  assert.equal(parseDocumentListQuery({ sortOrder: "sideways" }).success, false);
});

test("document list queries validate pagination", () => {
  const result = parseDocumentListQuery({ page: "2", pageSize: "50" });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.page, 2);
    assert.equal(result.data.pageSize, 50);
  }

  assert.equal(parseDocumentListQuery({ page: "0" }).success, false);
  assert.equal(parseDocumentListQuery({ pageSize: "101" }).success, false);
  assert.equal(parseDocumentListQuery({ page: String(Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1), pageSize: "100" }).success, false);
});

test("the registry service handles nullable search fields", async () => {
  const request = {
    select: () => request,
    eq: () => request,
    or: () => request,
    order: () => request,
    range: async () => ({ data: [{ ...document, document_number: null, persons_involved: null }], error: null, count: 1 }),
  };
  const result = await listDocuments({ from: () => request } as never, { q: "water", page: 1, pageSize: 25, sortBy: "created_at", sortOrder: "desc" });
  assert.equal(result.documents[0].document_number, null);
  assert.equal(result.documents[0].persons_involved, null);
});

test("the registry service preserves an empty page total", async () => {
  const request = {
    select: () => request,
    eq: () => request,
    order: () => request,
    range: async () => ({ data: [], error: null, count: 50 }),
  };
  const result = await listDocuments({ from: () => request } as never, { page: 3, pageSize: 25, sortBy: "created_at", sortOrder: "desc" });
  assert.deepEqual(result.documents, []);
  assert.equal(result.total, 50);
  assert.equal(result.page, 3);
});

const authorized: AuthorizationResult = { kind: "authorized", user: { id: "user-id", email: "staff@example.test", name: "Staff", role: "STAFF", status: "ACTIVE" } };
const listResult: PaginatedDocuments = { documents: [document], total: 1, page: 1, pageSize: 25 };
const request = (path: string) => ({ nextUrl: new URL(path, "http://localhost") });

function listHandler(authorization: AuthorizationResult, list = async () => listResult) {
  return createListDocumentsHandler({ getAuthorization: async () => authorization, parseListQuery: parseDocumentListQuery, listDocuments: list });
}

test("the list API rejects unauthenticated, unauthorized, and inactive users", async () => {
  for (const [authorization, status] of [[{ kind: "unauthenticated" }, 401], [{ kind: "not-authorized" }, 403], [{ kind: "inactive" }, 403]] as const) {
    const response = await listHandler(authorization)(request("/api/documents"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("the list API validates input and returns safe failures", async () => {
  const invalid = await listHandler(authorized)(request("/api/documents?page=0"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "private, no-store");
  assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");

  const failed = await listHandler(authorized, async () => { throw new Error("database details"); })(request("/api/documents"));
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await failed.json(), { error: { code: "REGISTRY_ERROR", message: "Documents are temporarily unavailable. Please try again." } });
});

test("the list API returns documents for an authorized user", async () => {
  const response = await listHandler(authorized)(request("/api/documents"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), listResult);
});

function detailHandler(authorization: AuthorizationResult, getDocument = async () => document) {
  return createGetDocumentHandler({ getAuthorization: async () => authorization, isDocumentId, getDocumentById: getDocument });
}

test("the document detail API rejects unauthenticated, unauthorized, and inactive users", async () => {
  for (const [authorization, status] of [[{ kind: "unauthenticated" }, 401], [{ kind: "not-authorized" }, 403], [{ kind: "inactive" }, 403]] as const) {
    const response = await detailHandler(authorization)(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("the document detail API validates, handles missing records and returns safe failures", async () => {
  const invalid = await detailHandler(authorized)(request("/api/documents/bad"), { params: Promise.resolve({ id: "bad" }) });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "private, no-store");

  const missing = await detailHandler(authorized, async () => null)(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "private, no-store");

  const failed = await detailHandler(authorized, async () => { throw new Error("database details"); })(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await failed.json(), { error: { code: "REGISTRY_ERROR", message: "Document details are temporarily unavailable. Please try again." } });
});

test("the document detail API returns a document for an authorized user", async () => {
  const response = await detailHandler(authorized)(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { document });
});

test("upload visibility follows the existing role boundary", () => {
  assert.equal(hasMinimumRole("VIEWER", "STAFF"), false);
  assert.equal(hasMinimumRole("STAFF", "STAFF"), true);
  assert.equal(hasMinimumRole("ADMIN", "STAFF"), true);
});

test("document IDs require UUID values before registry detail retrieval", () => {
  assert.equal(isDocumentId("2e0e9825-98bb-4f78-9875-766e0af3516a"), true);
  assert.equal(isDocumentId("not-a-document"), false);
});

test("the registry service retrieves filtered, sorted, paginated documents", async () => {
  const calls: string[] = [];
  const request = {
    select: () => { calls.push("select"); return request; },
    or: () => { calls.push("search"); return request; },
    eq: (_column: string, value: string) => { calls.push(value === "ACTIVE" ? "active" : "type"); return request; },
    gte: () => { calls.push("dateFrom"); return request; },
    lte: () => { calls.push("dateTo"); return request; },
    order: () => { calls.push("sort"); return request; },
    range: async () => { calls.push("page"); return { data: [document], error: null, count: 1 }; },
  };
  const supabase = { from: () => request };
  const result = await listDocuments(supabase as never, {
    q: "water",
    type: "Memorandum",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    page: 1,
    pageSize: 25,
    sortBy: "document_date",
    sortOrder: "asc",
  });

  assert.deepEqual(result.documents, [document]);
  assert.equal(result.total, 1);
  assert.deepEqual(calls, ["select", "active", "search", "type", "dateFrom", "dateTo", "sort", "page"]);
});

test("the registry service returns null for a missing document", async () => {
  const request = {
    select: () => request,
    eq: () => request,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const supabase = { from: () => request };
  assert.equal(await getDocumentById(supabase as never, document.document_id), null);
});

const adminUser: AuthorizedUser = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE" };
const staffUser: AuthorizedUser = { id: "22222222-2222-4222-8222-222222222222", email: "staff@example.test", name: "Staff", role: "STAFF", status: "ACTIVE" };
const viewerUser: AuthorizedUser = { id: "33333333-3333-4333-8333-333333333333", email: "viewer@example.test", name: "Viewer", role: "VIEWER", status: "ACTIVE" };
const confidentialDoc: DocumentRecord = {
  ...document,
  document_id: "99999999-9999-4999-8999-999999999999",
  subject: "Confidential executive board investigation",
  drive_file_id: "driveFileId_99999",
  confidential: true,
};

test("canReadDocument enforces active status, active deletion_state, and admin-only confidential access", () => {
  for (const user of [adminUser, staffUser, viewerUser]) {
    assert.equal(canReadDocument(user, { deletion_state: "ACTIVE", confidential: false }), true);
    assert.equal(canReadDocument(user, { deletion_state: "DELETED", confidential: false }), false);
  }
  assert.equal(canReadDocument(adminUser, { deletion_state: "ACTIVE", confidential: true }), true);
  assert.equal(canReadDocument(staffUser, { deletion_state: "ACTIVE", confidential: true }), false);
  assert.equal(canReadDocument(viewerUser, { deletion_state: "ACTIVE", confidential: true }), false);
  assert.equal(canReadDocument({ ...adminUser, status: "INACTIVE" }, { deletion_state: "ACTIVE", confidential: false }), false);
});

test("confidential documents are hidden from non-admin users in lists, detail, type filters, open, and download", async () => {
  for (const nonAdmin of [staffUser, viewerUser]) {
    const eqCalls: Array<[string, unknown]> = [];
    const queryChain = {
      select: () => queryChain,
      eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return queryChain; },
      order: () => queryChain,
      range: async () => ({ data: [document, confidentialDoc], error: null, count: 2 }),
      maybeSingle: async () => ({ data: confidentialDoc, error: null }),
    };
    const supabase = { from: () => queryChain };

    const listed = await listDocuments(supabase as never, { page: 1, pageSize: 25, sortBy: "created_at", sortOrder: "desc" }, nonAdmin);
    assert.equal(eqCalls.some(([col, val]) => col === "confidential" && val === false), true);
    assert.deepEqual(listed.documents.map((d) => d.document_id), [document.document_id]);

    assert.equal(await getDocumentById(supabase as never, confidentialDoc.document_id, nonAdmin), null);
    await listDocumentTypes(supabase as never, nonAdmin);

    const listResp = await listHandler({ kind: "authorized", user: nonAdmin }, async () => ({
      documents: [document, confidentialDoc],
      total: 2,
      page: 1,
      pageSize: 25,
    }))(request("/api/documents") as never);
    const listBody = await listResp.json();
    assert.deepEqual(listBody.documents.map((d: DocumentRecord) => d.document_id), [document.document_id]);
    assert.equal(listBody.total, 1);
    assert.doesNotMatch(JSON.stringify(listBody), /Confidential executive board investigation/);

    const detailResp = await detailHandler({ kind: "authorized", user: nonAdmin }, async () => confidentialDoc)(
      request(`/api/documents/${confidentialDoc.document_id}`) as never,
      { params: Promise.resolve({ id: confidentialDoc.document_id }) },
    );
    assert.equal(detailResp.status, 404);
    assert.doesNotMatch(await detailResp.text(), /Confidential executive board investigation/);

    let driveCalls = 0;
    const fileDeps = {
      getAuthorization: async () => ({ kind: "authorized" as const, user: nonAdmin }),
      isDocumentId,
      getDocument: async () => confidentialDoc,
      drive: {
        async generateFileId() { return "unused"; },
        async upload() { throw new Error("unused"); },
        async getMetadata() { driveCalls += 1; throw new Error("must not call Drive"); },
        async download() { driveCalls += 1; throw new Error("must not call Drive"); },
      },
    };
    const context = { params: Promise.resolve({ id: confidentialDoc.document_id }) };
    assert.equal((await createOpenDocumentHandler(fileDeps)(new Request("http://localhost"), context)).status, 404);
    assert.equal((await createDownloadDocumentHandler(fileDeps)(new Request("http://localhost"), context)).status, 404);
    assert.equal(driveCalls, 0);
  }

  const adminDetail = await detailHandler({ kind: "authorized", user: adminUser }, async () => confidentialDoc)(
    request(`/api/documents/${confidentialDoc.document_id}`) as never,
    { params: Promise.resolve({ id: confidentialDoc.document_id }) },
  );
  assert.equal(adminDetail.status, 200);
});

test("PATCH document confidentiality enforces ACTIVE ADMIN, same-origin, strict JSON validation, and server-derived actor", async () => {
  const id = confidentialDoc.document_id;
  for (const [auth, expectedStatus] of [
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "not-authorized" }, 403],
    [{ kind: "inactive" }, 403],
    [{ kind: "authorized", user: staffUser }, 403],
    [{ kind: "authorized", user: viewerUser }, 403],
  ] as const) {
    let called = false;
    const handler = createPatchDocumentConfidentialityHandler({
      getAuthorization: async () => auth,
      isDocumentId,
      setDocumentConfidentiality: async () => { called = true; return { outcome: "UPDATED", confidential: true }; },
    });
    const res = await handler(
      new Request(`http://localhost/api/documents/${id}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ confidential: true }),
      }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(res.status, expectedStatus);
    assert.equal(called, false);
  }

  const recorded: Array<{ documentId: string; actorId: string; confidential: boolean }> = [];
  const handler = createPatchDocumentConfidentialityHandler({
    getAuthorization: async () => ({ kind: "authorized", user: adminUser }),
    isDocumentId,
    setDocumentConfidentiality: async ({ documentId, actor, confidential }) => {
      recorded.push({ documentId, actorId: actor.id, confidential });
      return { outcome: "UPDATED", confidential };
    },
  });

  // Cross-origin rejected
  assert.equal(
    (await handler(
      new Request(`http://localhost/api/documents/${id}`, {
        method: "PATCH",
        headers: { origin: "https://attacker.example", "content-type": "application/json" },
        body: JSON.stringify({ confidential: true }),
      }),
      { params: Promise.resolve({ id }) },
    )).status,
    403,
  );

  // Invalid content-type, invalid UUID, non-boolean, and extra fields rejected
  assert.equal(
    (await handler(
      new Request(`http://localhost/api/documents/${id}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "text/plain" },
        body: JSON.stringify({ confidential: true }),
      }),
      { params: Promise.resolve({ id }) },
    )).status,
    400,
  );
  assert.equal(
    (await handler(
      new Request("http://localhost/api/documents/not-a-uuid", {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ confidential: true }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    )).status,
    400,
  );
  for (const invalidBody of [{ confidential: "yes" }, { confidential: true, actor_id: staffUser.id }, {}]) {
    assert.equal(
      (await handler(
        new Request(`http://localhost/api/documents/${id}`, {
          method: "PATCH",
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: JSON.stringify(invalidBody),
        }),
        { params: Promise.resolve({ id }) },
      )).status,
      400,
    );
  }

  // Valid update succeeds with server-derived actor ID
  const ok = await handler(
    new Request(`http://localhost/api/documents/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ confidential: true }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await ok.json(), { document: { document_id: id, confidential: true } });
  assert.deepEqual(recorded, [{ documentId: id, actorId: adminUser.id, confidential: true }]);
});

test("confidentiality migration defines column, can_read_document helpers, RLS policy, and service-role-only admin RPC", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20261029000000_add_document_confidentiality_and_can_read.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /add column confidential boolean not null default false/i);
  assert.match(migration, /create or replace function public\.can_read_document\(\s*p_user_email text,\s*p_deletion_state text,\s*p_confidential boolean\s*\)/i);
  assert.match(migration, /create or replace function public\.can_read_document\(\s*p_actor_id uuid,\s*p_document_id uuid\s*\)/i);
  assert.match(migration, /not coalesce\(p_confidential, false\) or actor\.role = 'ADMIN'/i);
  assert.match(migration, /create policy "Authorized active users can read accessible documents"[\s\S]*using \(\s*public\.can_read_document\(auth\.jwt\(\) ->> 'email', deletion_state, confidential\)\s*\)/i);
  assert.match(migration, /create or replace function public\.admin_set_document_confidential\(/i);
  assert.match(migration, /revoke all on function public\.admin_set_document_confidential\(uuid, uuid, boolean\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.admin_set_document_confidential\(uuid, uuid, boolean\) to service_role/i);
});
