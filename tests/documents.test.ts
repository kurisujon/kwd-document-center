import assert from "node:assert/strict";
import test from "node:test";
import { createGetDocumentHandler, createListDocumentsHandler } from "../src/lib/documents/api.ts";
import { hasMinimumRole } from "../src/lib/auth/permissions.ts";
import { isDocumentId, parseDocumentListQuery } from "../src/lib/documents/query.ts";
import { getDocumentById, listDocuments } from "../src/lib/documents/repository.ts";
import type { AuthorizationResult } from "../src/lib/auth/types.ts";
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
  }
});

test("the list API validates input and returns safe failures", async () => {
  const invalid = await listHandler(authorized)(request("/api/documents?page=0"));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");

  const failed = await listHandler(authorized, async () => { throw new Error("database details"); })(request("/api/documents"));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: { code: "REGISTRY_ERROR", message: "Documents are temporarily unavailable. Please try again." } });
});

test("the list API returns documents for an authorized user", async () => {
  const response = await listHandler(authorized)(request("/api/documents"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), listResult);
});

function detailHandler(authorization: AuthorizationResult, getDocument = async () => document) {
  return createGetDocumentHandler({ getAuthorization: async () => authorization, isDocumentId, getDocumentById: getDocument });
}

test("the document detail API rejects unauthenticated, unauthorized, and inactive users", async () => {
  for (const [authorization, status] of [[{ kind: "unauthenticated" }, 401], [{ kind: "not-authorized" }, 403], [{ kind: "inactive" }, 403]] as const) {
    const response = await detailHandler(authorization)(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
    assert.equal(response.status, status);
  }
});

test("the document detail API validates, handles missing records and returns safe failures", async () => {
  const invalid = await detailHandler(authorized)(request("/api/documents/bad"), { params: Promise.resolve({ id: "bad" }) });
  assert.equal(invalid.status, 400);

  const missing = await detailHandler(authorized, async () => null)(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
  assert.equal(missing.status, 404);

  const failed = await detailHandler(authorized, async () => { throw new Error("database details"); })(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: { code: "REGISTRY_ERROR", message: "Document details are temporarily unavailable. Please try again." } });
});

test("the document detail API returns a document for an authorized user", async () => {
  const response = await detailHandler(authorized)(request("/api/documents/document"), { params: Promise.resolve({ id: document.document_id }) });
  assert.equal(response.status, 200);
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
    eq: () => { calls.push("type"); return request; },
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
  assert.deepEqual(calls, ["select", "search", "type", "dateFrom", "dateTo", "sort", "page"]);
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
