import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  AuditQueryValidationError,
  createAuditRepository,
  createListAuditLogsHandler,
  validateAuditLogQuery,
} from "../src/lib/audit/audit-log";
import type { AuthorizedUser } from "../src/lib/auth/types";
import {
  createDownloadDocumentHandler,
  createOpenDocumentHandler,
} from "../src/lib/documents/file-api";
import { isDocumentId } from "../src/lib/documents/query";
import type { DocumentRecord } from "../src/lib/documents/types";
import type { DriveService } from "../src/lib/google/drive-types";

const adminUser: AuthorizedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@kwd.gov.ph",
  name: "KWD Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const staffUser: AuthorizedUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "staff@kwd.gov.ph",
  name: "KWD Staff",
  role: "STAFF",
  status: "ACTIVE",
};

const sampleDocument: DocumentRecord = {
  document_id: "2e0e9825-98bb-4f78-9875-766e0af3516a",
  document_type: "MEMORANDUM",
  document_number: "MEMO-2026-001",
  document_date: "2026-10-01",
  subject: "Water quality monitoring schedule",
  persons_involved: "Operations Division",
  drive_file_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz123456",
  drive_url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/view",
  file_name: "memo-2026-001.pdf",
  file_type: "application/pdf",
  filing_year: 2026,
  filing_subcategory: null,
  status: "ACTIVE",
  confidential: false,
  deletion_state: "ACTIVE",
  created_by: "admin@kwd.gov.ph",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

test("validateAuditLogQuery applies defaults and validates filters", () => {
  const defaults = validateAuditLogQuery({});
  assert.deepEqual(defaults, {
    actor: "",
    action: "",
    entityType: "",
    entityId: "",
    dateFrom: "",
    dateTo: "",
    page: 1,
    pageSize: 25,
  });

  const filtered = validateAuditLogQuery({
    actor: "admin@kwd.gov.ph",
    action: "DOCUMENT_OPEN",
    entityType: "DOCUMENT",
    entityId: sampleDocument.document_id,
    dateFrom: "2026-10-01",
    dateTo: "2026-10-29",
    page: "2",
    pageSize: "50",
  });
  assert.equal(filtered.actor, "admin@kwd.gov.ph");
  assert.equal(filtered.action, "DOCUMENT_OPEN");
  assert.equal(filtered.entityType, "DOCUMENT");
  assert.equal(filtered.page, 2);
  assert.equal(filtered.pageSize, 50);

  assert.throws(
    () => validateAuditLogQuery({ action: "INVALID_ACTION" }),
    (err) => err instanceof AuditQueryValidationError && err.field === "action",
  );
  assert.throws(
    () => validateAuditLogQuery({ dateFrom: "2026-10-20", dateTo: "2026-10-01" }),
    (err) => err instanceof AuditQueryValidationError && err.field === "dateFrom",
  );
});

test("createListAuditLogsHandler enforces ACTIVE ADMIN and returns paginated entries", async () => {
  const repository = createAuditRepository({
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      assert.equal(fn, "admin_list_audit_logs");
      assert.equal(args?.p_actor_id, adminUser.id);
      assert.equal(args?.p_filter_action, "DOCUMENT_OPEN");
      return {
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            actor_id: adminUser.id,
            actor_email: adminUser.email,
            action: "DOCUMENT_OPEN",
            entity_type: "DOCUMENT",
            entity_id: sampleDocument.document_id,
            metadata: { document_type: "MEMORANDUM", confidential: false },
            created_at: "2026-10-29T01:00:00.000Z",
            total_count: 1,
          },
        ],
        error: null,
      } as never;
    },
  });

  const staffHandler = createListAuditLogsHandler({
    getAuthorization: async () => ({ kind: "authorized", user: staffUser }),
    repository,
  });
  const staffRes = await staffHandler(new Request("https://app.example.com/api/admin/audit-log"));
  assert.equal(staffRes.status, 403);

  const adminHandler = createListAuditLogsHandler({
    getAuthorization: async () => ({ kind: "authorized", user: adminUser }),
    repository,
  });
  const adminRes = await adminHandler(
    new Request("https://app.example.com/api/admin/audit-log?action=DOCUMENT_OPEN"),
  );
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.headers.get("Cache-Control"), "private, no-store");
  const body = (await adminRes.json()) as { total: number; entries: Array<{ action: string }> };
  assert.equal(body.total, 1);
  assert.equal(body.entries[0]?.action, "DOCUMENT_OPEN");
});

test("Open and Download handlers record access audit events and fail closed if audit write fails", async () => {
  const recorded: Array<{ actorId: string; documentId: string; action: string }> = [];
  const fakeDrive: DriveService = {
    generateFileId: async () => "id",
    uploadFile: async () => ({ id: "id", name: "n", mimeType: "application/pdf" }),
    getMetadata: async () => ({
      id: sampleDocument.drive_file_id!,
      name: "memo-2026-001.pdf",
      mimeType: "application/pdf",
      size: 128,
    }),
    download: async () => ({
      name: "memo-2026-001.pdf",
      mimeType: "application/pdf",
      size: 4,
      stream: Readable.from([Buffer.from("test")]),
    }),
    trashFile: async () => ({ trashed: true }),
    createFolder: async () => ({ id: "f", name: "f" }),
  };

  const openHandler = createOpenDocumentHandler({
    getAuthorization: async () => ({ kind: "authorized", user: staffUser }),
    getDocument: async () => sampleDocument,
    isDocumentId,
    drive: fakeDrive,
    recordAccessAudit: async (actorId, documentId, action) => {
      recorded.push({ actorId, documentId, action });
    },
  });

  const openRes = await openHandler(
    new Request(`https://app.example.com/api/documents/${sampleDocument.document_id}/open`),
    { params: Promise.resolve({ id: sampleDocument.document_id }) },
  );
  assert.equal(openRes.status, 302);
  assert.deepEqual(recorded, [
    {
      actorId: staffUser.id,
      documentId: sampleDocument.document_id,
      action: "DOCUMENT_OPEN",
    },
  ]);

  const downloadHandler = createDownloadDocumentHandler({
    getAuthorization: async () => ({ kind: "authorized", user: staffUser }),
    getDocument: async () => sampleDocument,
    isDocumentId,
    drive: fakeDrive,
    recordAccessAudit: async (actorId, documentId, action) => {
      recorded.push({ actorId, documentId, action });
    },
  });

  const downloadRes = await downloadHandler(
    new Request(`https://app.example.com/api/documents/${sampleDocument.document_id}/download`),
    { params: Promise.resolve({ id: sampleDocument.document_id }) },
  );
  assert.equal(downloadRes.status, 200);
  assert.match(downloadRes.headers.get("Content-Disposition") ?? "", /^attachment;/);
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1]?.action, "DOCUMENT_DOWNLOAD");

  // Inline preview request (?inline=1) serves inline disposition without logging a duplicate download
  const inlineRes = await downloadHandler(
    new Request(
      `https://app.example.com/api/documents/${sampleDocument.document_id}/download?inline=1`,
    ),
    { params: Promise.resolve({ id: sampleDocument.document_id }) },
  );
  assert.equal(inlineRes.status, 200);
  assert.match(inlineRes.headers.get("Content-Disposition") ?? "", /^inline;/);
  assert.equal(recorded.length, 2);

  // Fail closed when audit write fails
  const failingOpenHandler = createOpenDocumentHandler({
    getAuthorization: async () => ({ kind: "authorized", user: staffUser }),
    getDocument: async () => sampleDocument,
    isDocumentId,
    drive: fakeDrive,
    recordAccessAudit: async () => {
      throw new Error("AUDIT_WRITE_FAILED");
    },
  });
  const failedOpenRes = await failingOpenHandler(
    new Request(`https://app.example.com/api/documents/${sampleDocument.document_id}/open`),
    { params: Promise.resolve({ id: sampleDocument.document_id }) },
  );
  assert.equal(failedOpenRes.status, 500);
});

test("audit_log migration enforces append-only semantics, no IP column, and transactional RPC logging", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20261029010000_create_audit_log.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create table public\.audit_log/i);
  assert.doesNotMatch(sql, /ip_address/i);
  assert.match(sql, /before update or delete on public\.audit_log/i);
  assert.match(
    sql,
    /revoke all on table public\.audit_log from public, anon, authenticated, service_role/i,
  );
  assert.match(sql, /create or replace function public\.record_document_access_audit/i);
  assert.match(sql, /create or replace function public\.admin_list_audit_logs/i);
  assert.match(sql, /'DOCUMENT_CONFIDENTIALITY_CHANGE'/);
  assert.match(sql, /'DOCUMENT_UPLOAD'/);
  assert.match(sql, /'DOCUMENT_DELETE'/);
  assert.match(sql, /'USER_CREATE'/);
  assert.match(sql, /'USER_UPDATE'/);
  assert.match(sql, /'FOLDER_CREATE'/);
});
