import assert from "node:assert/strict";
import test from "node:test";
import { getDashboardMetrics } from "../src/lib/dashboard/dashboard-service";
import { generateQrMatrix, generateQrSvg } from "../src/lib/qr/qr-generator";
import { generateDocumentsCsv } from "../src/lib/reports/report-service";
import { isDocumentStarred, listStarredDocuments, toggleDocumentStar } from "../src/lib/stars/star-service";
import type { DocumentRecord } from "../src/lib/documents/types";

const dummyAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@kwd.gov.ph",
  name: "District Admin",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
};

const dummyStaff = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "staff@kwd.gov.ph",
  name: "Records Officer",
  role: "STAFF" as const,
  status: "ACTIVE" as const,
};

test("QR Code generator creates valid 33x33 matrix and clean SVG markup", () => {
  const url = "https://kwd-document-center.local/documents/12345";
  const matrix = generateQrMatrix(url);

  // Version 4 matrix size
  assert.equal(matrix.length, 33);
  assert.equal(matrix[0].length, 33);

  // Top-left finder pattern: (0,0) is black
  assert.equal(matrix[0][0], true);
  // Center of top-left finder (3,3) is black
  assert.equal(matrix[3][3], true);

  // SVG generation
  const svg = generateQrSvg(url, { size: 200, title: "Test QR" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('aria-label="Test QR"'));
  assert.ok(svg.includes("<rect"));
  assert.ok(svg.includes("<path"));
  assert.ok(svg.endsWith("</svg>"));
});

test("generateDocumentsCsv formats RFC 4180 compliant CSV with proper escaping", () => {
  const sampleDocs: DocumentRecord[] = [
    {
      document_id: "doc-1",
      document_type: "MEMORANDUM",
      document_number: "MEMO-2026-001",
      document_date: "2026-01-15",
      subject: 'Guidelines for "Poblacion" Pipeline Maintenance, Section A',
      persons_involved: "Engr. Santos, Juan Dela Cruz",
      drive_file_id: "drive-1",
      drive_url: "https://drive.google.com/file-1",
      file_name: "guidelines.pdf",
      file_type: "application/pdf",
      filing_year: 2026,
      filing_subcategory: null,
      status: "ACTIVE",
      deletion_state: "ACTIVE",
      confidential: false,
      retention_status: "ACTIVE",
      expires_at: "2026-12-31T00:00:00Z",
      due_at: "2026-06-30T00:00:00Z",
      created_by: "staff@kwd.gov.ph",
      created_at: "2026-01-15T08:00:00Z",
      updated_at: "2026-01-15T08:00:00Z",
    },
  ];

  const csv = generateDocumentsCsv(sampleDocs);
  const lines = csv.split("\r\n");

  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("Document Number,Document Type"));

  // Check RFC 4180 quotes escaping: "Poblacion" -> ""Poblacion""
  assert.ok(lines[1].includes('""Poblacion""'));
  // Check comma in persons_involved is wrapped in quotes
  assert.ok(lines[1].includes('"Engr. Santos, Juan Dela Cruz"'));
});

test("toggleDocumentStar toggles star state through RPC", async () => {
  let starState = false;

  const fakeSupabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "toggle_document_star") {
        starState = !starState;
        return {
          data: [{ document_id: args.p_document_id, starred: starState }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  const res1 = await toggleDocumentStar(fakeSupabase as never, dummyStaff.id, "doc-1");
  assert.equal(res1.starred, true);

  const res2 = await toggleDocumentStar(fakeSupabase as never, dummyStaff.id, "doc-1");
  assert.equal(res2.starred, false);
});

test("isDocumentStarred queries user_document_stars table correctly", async () => {
  const fakeSupabase = {
    from: (table: string) => {
      if (table === "user_document_stars") {
        return {
          select: () => ({
            eq: () => ({
              eq: (_c2: string, v2: string) => ({
                maybeSingle: () => {
                  if (v2 === "doc-starred") {
                    return Promise.resolve({ data: { id: "star-1" }, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  const starred = await isDocumentStarred(fakeSupabase as never, dummyStaff.id, "doc-starred");
  assert.equal(starred, true);

  const notStarred = await isDocumentStarred(fakeSupabase as never, dummyStaff.id, "doc-unstarred");
  assert.equal(notStarred, false);
});

test("listStarredDocuments enforces can_read_document: confidential records hidden from non-admin", async () => {
  let queriedConfidentialFilter: boolean | undefined = undefined;

  type MockSelectBuilder = {
    eq: (col: string, val: unknown) => MockSelectBuilder;
    order: () => { range: () => Promise<{ data: unknown[]; count: number; error: null }> };
  };

  const fakeSupabase = {
    from: (table: string) => {
      if (table === "user_document_stars") {
        return {
          select: () => {
            const builder: MockSelectBuilder = {
              eq: (col: string, val: unknown) => {
                if (col === "document.confidential") {
                  queriedConfidentialFilter = Boolean(val);
                }
                return builder;
              },
              order: () => ({
                range: () => {
                  return Promise.resolve({
                    data: [
                      {
                        created_at: "2026-01-01",
                        document: {
                          document_id: "doc-1",
                          subject: "Public Starred Doc",
                          confidential: false,
                        },
                      },
                    ],
                    count: 1,
                    error: null,
                  });
                },
              }),
            };
            return builder;
          },
        };
      }
      return {};
    },
  };

  // Staff query must include confidential = false filter
  await listStarredDocuments(fakeSupabase as never, dummyStaff);
  assert.equal(queriedConfidentialFilter, false);

  // Admin query does not constrain confidential
  queriedConfidentialFilter = undefined;
  await listStarredDocuments(fakeSupabase as never, dummyAdmin);
  assert.equal(queriedConfidentialFilter, undefined);
});

test("getDashboardMetrics calculates summary and filters confidential records for non-admins", async () => {
  let confidentialFilteredInRecent = false;

  type MockDocBuilder = {
    eq: (col: string, val: unknown) => MockDocBuilder;
    gte: () => MockDocBuilder;
    order: () => { limit: () => Promise<{ data: unknown[]; error: null }> };
  };

  const fakeSupabase = {
    rpc: async (fn: string) => {
      if (fn === "get_dashboard_summary") {
        return {
          data: [
            {
              total_documents: 42,
              expiring_soon_count: 5,
              pending_retention_count: 2,
              type_counts: { MEMORANDUM: 20, "BOARD RESOLUTION": 15, CONTRACTS: 7 },
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "documents") {
        return {
          select: () => {
            const builder: MockDocBuilder = {
              eq: (col: string, val: unknown) => {
                if (col === "confidential" && val === false) {
                  confidentialFilteredInRecent = true;
                }
                return builder;
              },
              gte: () => builder,
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            };
            return builder;
          },
        };
      }
      return {};
    },
  };

  // Staff metrics call
  const staffMetrics = await getDashboardMetrics(fakeSupabase as never, dummyStaff);
  assert.equal(staffMetrics.totalDocuments, 42);
  assert.equal(staffMetrics.expiringSoonCount, 5);
  assert.equal(staffMetrics.pendingRetentionCount, 2);
  assert.equal(staffMetrics.typeCounts["MEMORANDUM"], 20);
  assert.equal(confidentialFilteredInRecent, true);
});
