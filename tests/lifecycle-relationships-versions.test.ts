import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isStatusTransitionAllowed } from "../src/lib/documents/document-types-config";
import { dryRunImport } from "../src/lib/documents/importer";
import { detectSupersedeCycle, filterLinksForViewer } from "../src/lib/documents/relationships";
import type { DocumentLinkRecord, DocumentStatus } from "../src/lib/documents/types";

const dummyAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@kwd.gov.ph",
  name: "Admin",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
};

const dummyStaff = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "staff@kwd.gov.ph",
  name: "Staff",
  role: "STAFF" as const,
  status: "ACTIVE" as const,
};

const dummyViewer = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "viewer@kwd.gov.ph",
  name: "Viewer",
  role: "VIEWER" as const,
  status: "ACTIVE" as const,
};

test("status transition lifecycle enforces state machine rules per role", () => {
  // 1. DRAFT -> UNDER_REVIEW allowed for STAFF and ADMIN
  assert.equal(isStatusTransitionAllowed("DRAFT", "UNDER_REVIEW", "STAFF").allowed, true);
  assert.equal(isStatusTransitionAllowed("DRAFT", "UNDER_REVIEW", "ADMIN").allowed, true);

  // 2. UNDER_REVIEW -> APPROVED requires ADMIN
  assert.equal(isStatusTransitionAllowed("UNDER_REVIEW", "APPROVED", "STAFF").allowed, false);
  assert.equal(isStatusTransitionAllowed("UNDER_REVIEW", "APPROVED", "ADMIN").allowed, true);

  // 3. APPROVED -> ACTIVE allowed for STAFF and ADMIN
  assert.equal(isStatusTransitionAllowed("APPROVED", "ACTIVE", "STAFF").allowed, true);
  assert.equal(isStatusTransitionAllowed("APPROVED", "ACTIVE", "ADMIN").allowed, true);

  // 4. ACTIVE -> SUPERSEDED requires ADMIN
  assert.equal(isStatusTransitionAllowed("ACTIVE", "SUPERSEDED", "STAFF").allowed, false);
  assert.equal(isStatusTransitionAllowed("ACTIVE", "SUPERSEDED", "ADMIN").allowed, true);

  // 5. ACTIVE -> ARCHIVED requires ADMIN
  assert.equal(isStatusTransitionAllowed("ACTIVE", "ARCHIVED", "STAFF").allowed, false);
  assert.equal(isStatusTransitionAllowed("ACTIVE", "ARCHIVED", "ADMIN").allowed, true);

  // 6. SUPERSEDED -> ARCHIVED requires ADMIN
  assert.equal(isStatusTransitionAllowed("SUPERSEDED", "ARCHIVED", "STAFF").allowed, false);
  assert.equal(isStatusTransitionAllowed("SUPERSEDED", "ARCHIVED", "ADMIN").allowed, true);

  // 7. ARCHIVED -> ACTIVE requires ADMIN
  assert.equal(isStatusTransitionAllowed("ARCHIVED", "ACTIVE", "STAFF").allowed, false);
  assert.equal(isStatusTransitionAllowed("ARCHIVED", "ACTIVE", "ADMIN").allowed, true);

  // 8. Invalid transitions rejected for everyone
  assert.equal(isStatusTransitionAllowed("DRAFT", "SUPERSEDED", "ADMIN").allowed, false);
  assert.equal(isStatusTransitionAllowed("APPROVED", "DRAFT", "ADMIN").allowed, false);
  assert.equal(isStatusTransitionAllowed("ARCHIVED", "UNDER_REVIEW", "ADMIN").allowed, false);

  // 9. Viewers cannot perform any transitions
  const allStatuses: DocumentStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUPERSEDED", "ARCHIVED"];
  for (const from of allStatuses) {
    for (const to of allStatuses) {
      if (from !== to) {
        assert.equal(isStatusTransitionAllowed(from, to, "VIEWER").allowed, false);
      }
    }
  }
});

test("supersede cycle detection prevents cyclic supersede relationships", () => {
  const docA = "11111111-1111-4111-8111-111111111111";
  const docB = "22222222-2222-4222-8222-222222222222";
  const docC = "33333333-3333-4333-8333-333333333333";
  const docD = "44444444-4444-4444-8444-444444444444";

  // Self-link is immediately a cycle
  assert.equal(detectSupersedeCycle([], docA, docA), true);

  // A supersedes B (no prior links) -> ok
  const links = [{ from_id: docA, to_id: docB, relation: "SUPERSEDES" }];
  assert.equal(detectSupersedeCycle([], docA, docB), false);

  // B supersedes A would form direct cycle A -> B -> A -> fails
  assert.equal(detectSupersedeCycle(links, docB, docA), true);

  // B supersedes C -> ok
  assert.equal(detectSupersedeCycle(links, docB, docC), false);
  links.push({ from_id: docB, to_id: docC, relation: "SUPERSEDES" });

  // C supersedes A would form transitive cycle A -> B -> C -> A -> fails
  assert.equal(detectSupersedeCycle(links, docC, docA), true);

  // C supersedes B would form direct cycle B -> C -> B -> fails
  assert.equal(detectSupersedeCycle(links, docC, docB), true);

  // C supersedes D -> ok
  assert.equal(detectSupersedeCycle(links, docC, docD), false);
  links.push({ from_id: docC, to_id: docD, relation: "SUPERSEDES" });

  // D supersedes A would form transitive cycle A -> B -> C -> D -> A -> fails
  assert.equal(detectSupersedeCycle(links, docD, docA), true);

  // Non-SUPERSEDES relations (RELATES_TO, AMENDS) do not count as supersede cycles
  const mixedLinks = [
    { from_id: docA, to_id: docB, relation: "RELATES_TO" },
    { from_id: docB, to_id: docA, relation: "RELATES_TO" },
    { from_id: docA, to_id: docC, relation: "AMENDS" },
  ];
  assert.equal(detectSupersedeCycle(mixedLinks, docB, docA), false);
});

test("confidentiality: links referencing confidential documents are hidden from non-admin viewers", () => {
  const publicLink: DocumentLinkRecord = {
    id: "link-1",
    from_id: "doc-1",
    to_id: "doc-2",
    relation: "RELATES_TO",
    created_by: dummyStaff.id,
    created_at: "2026-10-29T00:00:00.000Z",
    target_document: {
      document_id: "doc-2",
      document_type: "MEMORANDUM",
      document_number: "MEMO-2026-001",
      subject: "Public Memorandum",
      confidential: false,
    },
  };

  const confidentialLink: DocumentLinkRecord = {
    id: "link-2",
    from_id: "doc-1",
    to_id: "doc-3",
    relation: "SUPERSEDES",
    created_by: dummyAdmin.id,
    created_at: "2026-10-29T00:00:00.000Z",
    target_document: {
      document_id: "doc-3",
      document_type: "BOARD RESOLUTION",
      document_number: "BOD-CONF-001",
      subject: "Confidential Executive Session Resolution",
      confidential: true,
    },
  };

  const allLinks = [publicLink, confidentialLink];

  // Admin sees all links including confidential
  const adminLinks = filterLinksForViewer(allLinks, dummyAdmin);
  assert.equal(adminLinks.length, 2);
  assert.deepEqual(adminLinks.map((l) => l.id), ["link-1", "link-2"]);

  // Staff cannot see confidential links
  const staffLinks = filterLinksForViewer(allLinks, dummyStaff);
  assert.equal(staffLinks.length, 1);
  assert.equal(staffLinks[0]?.id, "link-1");

  // Viewer cannot see confidential links
  const viewerLinks = filterLinksForViewer(allLinks, dummyViewer);
  assert.equal(viewerLinks.length, 1);
  assert.equal(viewerLinks[0]?.id, "link-1");
});

test("dryRunImport parses CSV, extracts meta_* custom fields, matches files, and checks duplicates", () => {
  const csvData = [
    "relative_path,document_type,document_number,document_date,subject,persons_involved,meta_series_year,meta_office_origin",
    "memos/memo1.pdf,MEMORANDUM,MEMO-2026-001,2026-01-15,Water Maintenance Schedule,All Staff,2026,OFFICE_OF_THE_GM",
    "memos/memo2.pdf,MEMORANDUM,MEMO-2026-002,2026-02-01,Emergency Pumping Station Repair,Technical Team,2026,OPERATIONS",
  ].join("\r\n");

  const file1Bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const file2Bytes = new Uint8Array([6, 7, 8, 9, 10]);

  const files = [
    { relativePath: "memos/memo1.pdf", bytes: file1Bytes, mimeType: "application/pdf" },
    { relativePath: "memos/memo2.pdf", bytes: file2Bytes, mimeType: "application/pdf" },
  ];

  const report = dryRunImport(csvData, files);
  assert.equal(report.totalRows, 2);
  assert.equal(report.matchedFiles, 2);
  assert.equal(report.validRows, 2);
  assert.equal(report.ready, true);
  assert.equal(report.issues.length, 0);

  // Check extracted custom metadata
  assert.deepEqual(report.parsedRows[0]?.customMetadata, {
    series_year: 2026,
    office_origin: "OFFICE_OF_THE_GM",
  });
  assert.deepEqual(report.parsedRows[1]?.customMetadata, {
    series_year: 2026,
    office_origin: "OPERATIONS",
  });

  // Duplicate detection flags duplicate document number and hash
  const existingRecords = [
    {
      file_sha256: report.parsedRows[0]?.fileSha256,
      document_number: "MEMO-2026-001",
      document_type: "MEMORANDUM",
    },
  ];

  const duplicateReport = dryRunImport(csvData, files, existingRecords);
  assert.equal(duplicateReport.issues.some((i) => i.kind === "DUPLICATE_WARNING" && i.field === "file"), true);
  assert.equal(duplicateReport.issues.some((i) => i.kind === "DUPLICATE_WARNING" && i.field === "document_number"), true);
});

test("Milestone 3 migration and ADR contracts are properly defined", () => {
  const migrationPath = path.join(process.cwd(), "supabase/migrations/20261029040000_add_document_lifecycle_links_versions_tags.sql");
  const migrationSql = readFileSync(migrationPath, "utf-8");

  // Audit log actions extended
  assert.match(migrationSql, /DOCUMENT_STATUS_CHANGE/);
  assert.match(migrationSql, /DOCUMENT_LINK_CREATE/);
  assert.match(migrationSql, /DOCUMENT_LINK_DELETE/);
  assert.match(migrationSql, /DOCUMENT_VERSION_UPLOAD/);
  assert.match(migrationSql, /DOCUMENT_TAG_ADD/);
  assert.match(migrationSql, /DOCUMENT_TAG_REMOVE/);

  // Document status check expanded
  assert.match(migrationSql, /status in \('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED'\)/i);
  assert.match(migrationSql, /version_count integer not null default 1/i);

  // document_links table and acyclic supersede check
  assert.match(migrationSql, /create table if not exists public\.document_links/i);
  assert.match(migrationSql, /check \(from_id <> to_id\)/i);
  assert.match(migrationSql, /unique \(from_id, to_id, relation\)/i);
  assert.match(migrationSql, /function public\.check_supersede_cycle/i);
  assert.match(migrationSql, /SUPERSEDE_CYCLE_DETECTED/);

  // RLS on document_links enforces can_read_document on both endpoints
  assert.match(migrationSql, /public\.can_read_document\(auth\.jwt\(\) ->> 'email', d1\.deletion_state, d1\.confidential\)/);
  assert.match(migrationSql, /public\.can_read_document\(auth\.jwt\(\) ->> 'email', d2\.deletion_state, d2\.confidential\)/);

  // document_versions table
  assert.match(migrationSql, /create table if not exists public\.document_versions/i);
  assert.match(migrationSql, /unique \(document_id, version_number\)/i);

  // tags, document_tags, and saved_filters
  assert.match(migrationSql, /create table if not exists public\.tags/i);
  assert.match(migrationSql, /create table if not exists public\.document_tags/i);
  assert.match(migrationSql, /create table if not exists public\.saved_filters/i);

  // Security Definer RPCs and service_role grants
  for (const rpc of [
    "change_document_status",
    "add_document_link",
    "remove_document_link",
    "add_document_version",
    "add_document_tag",
    "remove_document_tag",
  ]) {
    assert.match(migrationSql, new RegExp(`create or replace function public\\.${rpc}`, "i"));
    assert.match(migrationSql, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*to service_role`, "i"));
  }

  // ADR-008
  const adrPath = path.join(process.cwd(), "docs/architecture/ADR-008-relationships-versions-and-lifecycle.md");
  const adrContent = readFileSync(adrPath, "utf-8");
  assert.match(adrContent, /ADR-008/i);
  assert.match(adrContent, /Canonical File vs\. Version History/i);
  assert.match(adrContent, /SUPERSEDES/);
});
