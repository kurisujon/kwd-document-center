import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getDocumentTypeConfig,
  validateCustomMetadata,
} from "../src/lib/documents/document-types-config";
import { parseDocumentListQuery } from "../src/lib/documents/query";
import { listDocuments } from "../src/lib/documents/repository";
import {
  DocumentUploadError,
  uploadAdminDocument,
} from "../src/lib/documents/upload-service";
import { validateAdminUploadForm } from "../src/lib/documents/upload-validation";

const dummyStaff = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "staff@kwd.gov.ph",
  name: "Staff",
  role: "STAFF" as const,
  status: "ACTIVE" as const,
};

test("document-types-config validates reviewed code schemas and sanitizes custom fields", () => {
  const memoConfig = getDocumentTypeConfig("MEMORANDUM");
  assert.ok(memoConfig);
  assert.equal(memoConfig.type, "MEMORANDUM");

  // Valid memorandum metadata
  const validMemo = validateCustomMetadata("MEMORANDUM", {
    series_year: "2026",
    office_origin: "OFFICE_OF_THE_GM",
    signatory: "Engr. Juan Dela Cruz",
    action_required: "FOR_COMPLIANCE",
    empty_field: "",
  });
  assert.equal(validMemo.success, true);
  if (validMemo.success) {
    assert.deepEqual(validMemo.data, {
      series_year: 2026,
      office_origin: "OFFICE_OF_THE_GM",
      signatory: "Engr. Juan Dela Cruz",
      action_required: "FOR_COMPLIANCE",
    });
  }

  // Invalid year bounds
  const invalidMemo = validateCustomMetadata("MEMORANDUM", {
    series_year: 1800,
  });
  assert.equal(invalidMemo.success, false);

  // Board resolution validation
  const validBR = validateCustomMetadata("BOARD RESOLUTION", {
    resolution_number: "BR-2026-088",
    session_date: "2026-06-15",
    presiding_officer: "Dir. Pedro Penduko",
    sponsor: "Dir. Maria Clara",
  });
  assert.equal(validBR.success, true);

  // Contract validation
  const validContract = validateCustomMetadata("CONTRACTS", {
    contractor_name: "ABC Water Pipe Construction Corp",
    contract_amount: "1500000.50",
    validity_start: "2026-01-01",
    validity_end: "2026-12-31",
  });
  assert.equal(validContract.success, true);
  if (validContract.success) {
    assert.equal(validContract.data.contract_amount, 1500000.5);
  }

  // Non-object input rejected safely
  assert.equal(validateCustomMetadata("MEMORANDUM", "invalid").success, false);
});

test("parseDocumentListQuery extracts type-specific custom filters from URL params", () => {
  const parsed = parseDocumentListQuery({
    type: "MEMORANDUM",
    meta_series_year: "2026",
    meta_office_origin: "OFFICE_OF_THE_GM",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.customFilters, {
      series_year: "2026",
      office_origin: "OFFICE_OF_THE_GM",
    });
  }
});

test("listDocuments applies custom metadata filters with proper escaping", async () => {
  const calls: string[] = [];
  const fakeRequest = {
    eq: (col: string, val: string) => {
      calls.push(`eq:${col}=${val}`);
      return fakeRequest;
    },
    ilike: (col: string, val: string) => {
      calls.push(`ilike:${col}=${val}`);
      return fakeRequest;
    },
    or: (val: string) => {
      calls.push(`or:${val}`);
      return fakeRequest;
    },
    gte: () => fakeRequest,
    lte: () => fakeRequest,
    order: () => fakeRequest,
    range: async () => ({ data: [], count: 0, error: null }),
  };

  const fakeSupabase = {
    from: () => ({
      select: () => fakeRequest,
    }),
  };

  await listDocuments(
    fakeSupabase as never,
    {
      page: 1,
      pageSize: 25,
      sortBy: "created_at",
      sortOrder: "desc",
      type: "MEMORANDUM",
      customFilters: { series_year: "2026", office_origin: "OFFICE_OF_THE_GM" },
    },
    dummyStaff,
  );

  assert.ok(calls.includes("ilike:custom_metadata->>series_year=%2026%"));
  assert.ok(calls.includes("ilike:custom_metadata->>office_origin=%OFFICE\\_OF\\_THE\\_GM%"));
});

test("duplicate detection flags duplicate file hash and duplicate document number", async () => {
  const fakeFileBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fakeFileSha256 = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

  let checked = false;
  const duplicateRepo = {
    findByIdempotencyKey: async () => null,
    create: async () => {
      throw new Error("must not create when duplicate found");
    },
    claimDriveIdReservation: async () => ({ claimed: true, operationToken: "tok" }),
    clearDriveIdReservation: async () => {},
    persistDriveFileId: async () => true,
    resumeUpload: async () => ({ resumed: true, operationToken: "tok" }),
    recoverInterruptedUploadToFailed: async () => ({ changed: true, attempt: null }),
    markPendingRegistry: async () => true,
    markFailed: async () => ({ changed: true, attempt: null }),
    finalize: async () => {
      throw new Error("unused");
    },
    getDocument: async () => null,
    checkDuplicate: async () => {
      checked = true;
      return {
        duplicateKind: "HASH" as const,
        existingDocumentId: "11111111-1111-4111-8111-111111111111",
        existingDocumentNumber: "MEMO-2026-001",
        existingSubject: "Water Schedule",
        isConfidential: false,
      };
    },
  };

  const uploadInput = {
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    metadata: {
      document_type: "MEMORANDUM" as const,
      document_number: "MEMO-2026-001",
      document_date: "2026-01-01",
      subject: "Test",
      persons_involved: "",
      filing_year: 2026,
      filing_subcategory: "",
    },
    file: {
      name: "test.pdf",
      mimeType: "application/pdf",
      size: 5,
      bytes: fakeFileBytes,
    },
    fileSha256: fakeFileSha256,
    duplicateOverride: false,
  };

  // 1. Without override, rejected with DUPLICATE_DOCUMENT (409)
  await assert.rejects(
    () =>
      uploadAdminDocument({
        upload: uploadInput,
        user: dummyStaff,
        repository: duplicateRepo,
        drive: {
          generateFileId: async () => "id",
          upload: async () => ({ id: "id", name: "n", mimeType: "m", trashed: false, webViewLink: "l" }),
          getMetadata: async () => ({ id: "id", name: "n", mimeType: "m", trashed: false, webViewLink: "l" }),
          download: async () => {
            throw new Error("unused");
          },
        },
      }),
    (err: unknown) => err instanceof DocumentUploadError && err.code === "DUPLICATE_DOCUMENT" && err.status === 409,
  );
  assert.equal(checked, true);

  // 2. Confidential duplicate hides subject and document number from error message
  const confidentialDuplicateRepo = {
    ...duplicateRepo,
    checkDuplicate: async () => ({
      duplicateKind: "CONFIDENTIAL_HASH" as const,
      existingDocumentId: "33333333-3333-4333-8333-333333333333",
      existingDocumentNumber: null,
      existingSubject: null,
      isConfidential: true,
    }),
  };

  await assert.rejects(
    () =>
      uploadAdminDocument({
        upload: uploadInput,
        user: dummyStaff,
        repository: confidentialDuplicateRepo,
        drive: {
          generateFileId: async () => "id",
          upload: async () => ({ id: "id", name: "n", mimeType: "m", trashed: false, webViewLink: "l" }),
          getMetadata: async () => ({ id: "id", name: "n", mimeType: "m", trashed: false, webViewLink: "l" }),
          download: async () => {
            throw new Error("unused");
          },
        },
      }),
    (err: unknown) =>
      err instanceof DocumentUploadError &&
      err.code === "DUPLICATE_DOCUMENT" &&
      !err.message.includes("Water Schedule"),
  );
});

test("duplicate override allows reasoned bypass and validates required reason", async () => {
  const formData = new FormData();
  formData.set("idempotency_key", "44444444-4444-4444-8444-444444444444");
  formData.set("document_type", "MEMORANDUM");
  formData.set("document_date", "2026-01-01");
  formData.set("subject", "Test Override");
  formData.set("filing_year", "2026");
  formData.set("duplicate_override", "true");
  formData.set("file", new File([Buffer.from("%PDF-1.4 test")], "test.pdf", { type: "application/pdf" }));

  // Missing duplicate_override_reason should fail validation
  await assert.rejects(
    () => validateAdminUploadForm(formData),
    (err: unknown) => (err as { field?: string }).field === "duplicate_override_reason",
  );

  // With reason provided, validates successfully
  formData.set("duplicate_override_reason", "Official amendment to existing memo approved by GM");
  const validated = await validateAdminUploadForm(formData);
  assert.equal(validated.duplicateOverride, true);
  assert.equal(validated.duplicateOverrideReason, "Official amendment to existing memo approved by GM");
  assert.ok(validated.fileSha256 && validated.fileSha256.length === 64);
});

test("Milestone 2 migration and ADR contracts are properly defined", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20261029030000_add_document_custom_metadata_and_hash.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /add column if not exists custom_metadata jsonb/i);
  assert.match(sql, /add column if not exists file_sha256 text/i);
  assert.match(sql, /create index if not exists documents_file_sha256_idx/i);
  assert.match(sql, /create or replace function public\.check_document_duplicate/i);
  assert.match(sql, /can_read_document/i);
  assert.match(sql, /'CONFIDENTIAL_HASH'/);
  assert.match(sql, /'CONFIDENTIAL_NUMBER'/);

  const adrPath = path.join(
    process.cwd(),
    "docs/architecture/ADR-007-document-types-and-metadata.md",
  );
  const adr = readFileSync(adrPath, "utf8");
  assert.match(adr, /ADR-007/i);
  assert.match(adr, /custom_metadata/i);
  assert.match(adr, /file_sha256/i);
  assert.match(adr, /Duplicate Detection/i);
});
