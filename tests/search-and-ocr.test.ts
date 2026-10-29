import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  extractDigitalText,
  performDriveNativeOcr,
  processOcrBatch,
} from "../src/lib/ocr/ocr-service";
import { generateSnippet, searchDocuments } from "../src/lib/search/search-service";

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

test("generateSnippet highlights matching terms within word window", () => {
  const fullText =
    "The Kiblawan Water District Board of Directors met at the Main Office in Barangay Poblacion to approve the 2026 Water Supply System Expansion. The resolution was passed unanimously by the members present.";

  const snippet = generateSnippet(fullText, "Barangay Poblacion");
  assert.ok(snippet.includes("<b>Barangay</b>") || snippet.includes("<b>Poblacion</b>"));
  assert.ok(snippet.includes("Board of Directors"));

  // Empty or non-matching query handling
  assert.equal(generateSnippet("", "test"), "");
  assert.equal(generateSnippet("Some text", ""), "");

  const fallback = generateSnippet(fullText, "NonExistentWord");
  assert.ok(fallback.startsWith("The Kiblawan Water District"));
});

test("extractDigitalText decodes plain text and CSV files directly", () => {
  const textBytes = new TextEncoder().encode("Kiblawan Water District Office Order 2026-001");
  const result = extractDigitalText(textBytes, "text/plain");
  assert.equal(result, "Kiblawan Water District Office Order 2026-001");

  const csvBytes = new TextEncoder().encode("col1,col2\r\nval1,val2");
  const csvResult = extractDigitalText(csvBytes, "text/csv");
  assert.equal(csvResult, "col1,col2\r\nval1,val2");

  // Non-text returns null
  assert.equal(extractDigitalText(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf"), null);
});

test("performDriveNativeOcr downloads file and extracts text content", async () => {
  const mockDrive = {
    generateFileId: async () => "file-123",
    upload: async () => ({ id: "file-123", name: "n", mimeType: "m", trashed: false }),
    getMetadata: async () => ({ id: "file-123", name: "n", mimeType: "m", trashed: false }),
    download: async (fileId: string) => ({
      id: fileId,
      name: "sample.txt",
      mimeType: "text/plain",
      stream: Readable.from([Buffer.from("Directly extracted memorandum content for test.")]),
      size: 47,
      trashed: false,
      webViewLink: "",
    }),
  };

  const text = await performDriveNativeOcr(mockDrive as never, "file-123");
  assert.ok(text.includes("Directly extracted memorandum content"));
});

test("processOcrBatch claims pending jobs, executes OCR, and completes jobs atomically", async () => {
  const completedJobs: string[] = [];
  const fakeSupabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "claim_ocr_jobs") {
        return {
          data: [
            {
              job_id: "job-1",
              document_id: "doc-1",
              drive_file_id: "drive-1",
              file_name: "resolution.txt",
              file_type: "text/plain",
              attempts: 1,
              worker_token: args.p_worker_token,
            },
          ],
          error: null,
        };
      }
      if (fn === "complete_ocr_job") {
        completedJobs.push(String(args.p_job_id));
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  };

  const mockDrive = {
    generateFileId: async () => "id",
    upload: async () => ({ id: "id", name: "n", mimeType: "m", trashed: false }),
    getMetadata: async () => ({ id: "id", name: "n", mimeType: "m", trashed: false }),
    download: async () => ({
      id: "drive-1",
      name: "resolution.txt",
      mimeType: "text/plain",
      stream: Readable.from([Buffer.from("Board Resolution approved text.")]),
      size: 31,
      trashed: false,
      webViewLink: "",
    }),
  };

  const result = await processOcrBatch(fakeSupabase as never, mockDrive as never);
  assert.equal(result.processed, 1);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(completedJobs, ["job-1"]);
});

test("searchDocuments respects can_read_document: confidential records are masked from non-admins", async () => {
  const fakeSupabase = {
    rpc: async (fn: string) => {
      if (fn === "search_documents_fulltext") {
        return {
          data: [
            {
              document_id: "doc-pub",
              document_type: "MEMORANDUM",
              document_number: "MEMO-2026-001",
              document_date: "2026-01-15",
              subject: "Public Office Guidelines",
              status: "ACTIVE",
              confidential: false,
              file_name: "guidelines.pdf",
              snippet: "Public <b>Office</b> Guidelines for staff.",
              rank: 0.9,
              total_count: 2,
            },
            {
              document_id: "doc-conf",
              document_type: "BOARD RESOLUTION",
              document_number: "BOD-CONF-002",
              document_date: "2026-01-20",
              subject: "Confidential Executive Evaluation",
              status: "ACTIVE",
              confidential: true,
              file_name: "evaluation.pdf",
              snippet: "Confidential <b>Executive</b> Evaluation document.",
              rank: 0.95,
              total_count: 2,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  // Staff search: confidential document is filtered out
  const staffResult = await searchDocuments(
    fakeSupabase as never,
    { query: "evaluation" },
    dummyStaff,
  );
  assert.equal(staffResult.hits.length, 1);
  assert.equal(staffResult.hits[0]?.document.document_id, "doc-pub");

  // Admin search: both documents are returned
  const adminResult = await searchDocuments(
    fakeSupabase as never,
    { query: "evaluation" },
    dummyAdmin,
  );
  assert.equal(adminResult.hits.length, 2);
  assert.deepEqual(adminResult.hits.map((h) => h.document.document_id), ["doc-pub", "doc-conf"]);
});

test("Milestone 4 migration and ADR contracts are properly defined", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20261029050000_add_search_and_ocr.sql",
  );
  const migrationSql = readFileSync(migrationPath, "utf-8");

  // Extension and document_text
  assert.match(migrationSql, /create extension if not exists pg_trgm/i);
  assert.match(migrationSql, /create table if not exists public\.document_text/i);
  assert.match(migrationSql, /tsv tsvector generated always as \(to_tsvector\('simple', extracted_text\)\) stored/i);
  assert.match(migrationSql, /create index if not exists document_text_tsv_idx on public\.document_text using gin\(tsv\)/i);
  assert.match(migrationSql, /create index if not exists document_text_trgm_idx on public\.document_text using gin\(extracted_text gin_trgm_ops\)/i);

  // ocr_jobs table
  assert.match(migrationSql, /create table if not exists public\.ocr_jobs/i);
  assert.match(migrationSql, /status text not null default 'PENDING' check \(status in \('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'\)\)/i);

  // search_documents_fulltext RPC
  assert.match(migrationSql, /create or replace function public\.search_documents_fulltext/i);
  assert.match(migrationSql, /plainto_tsquery\('simple', v_clean_query\)/i);
  assert.match(migrationSql, /ts_headline/i);
  assert.match(migrationSql, /public\.can_read_document\(p_user_email, d\.deletion_state, d\.confidential\)/i);

  // Worker RPCs
  assert.match(migrationSql, /create or replace function public\.claim_ocr_jobs/i);
  assert.match(migrationSql, /create or replace function public\.complete_ocr_job/i);
  assert.match(migrationSql, /create or replace function public\.fail_ocr_job/i);

  // Service role grants
  for (const rpc of [
    "search_documents_fulltext",
    "claim_ocr_jobs",
    "complete_ocr_job",
    "fail_ocr_job",
  ]) {
    assert.match(migrationSql, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*to service_role`, "i"));
  }

  // ADR-009
  const adrPath = path.join(
    process.cwd(),
    "docs/architecture/ADR-009-search-and-ocr.md",
  );
  const adrContent = readFileSync(adrPath, "utf-8");
  assert.match(adrContent, /ADR-009/i);
  assert.match(adrContent, /Drive Native OCR/i);
  assert.match(adrContent, /'simple'/i);
});
