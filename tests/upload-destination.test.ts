import assert from "node:assert/strict";
import test from "node:test";
import type { HierarchyFolderRecord } from "../src/lib/documents/hierarchy-repository.ts";
import { listUploadDestinations, resolveUploadDestination, UploadDestinationError } from "../src/lib/documents/upload-destination.ts";

const record = (overrides: Partial<HierarchyFolderRecord> = {}): HierarchyFolderRecord => ({
  id: "11111111-1111-4111-8111-111111111111", idempotencyKey: "key", logicalParentKey: "ADMIN|2027", parentFolderId: null,
  departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: 2027, category: "BACTI TEST", subcategory: null,
  logicalKey: "ADMIN|2027|BACTI TEST", name: "BACTI TEST", normalizedName: "bacti test", source: "DYNAMIC", status: "ACTIVE",
  driveParentId: "fake-parent-drive-id", driveFolderId: "fake-drive-id", uploadEnabled: true, operationToken: null, leaseExpiresAt: null,
  createdBy: "actor", errorCategory: null, createdAt: "2026-10-05", updatedAt: "2026-10-05", ...overrides,
});

test("resolves only canonical enabled ADMIN hierarchy destinations", async () => {
  const entries = new Map<string, HierarchyFolderRecord>([
    ["category", record()],
    ["subcategory", record({ id: "22222222-2222-4222-8222-222222222222", hierarchyKind: "SUBCATEGORY", category: "BAC", subcategory: "AGENDAS", logicalKey: "ADMIN|2027|BAC|AGENDAS" })],
    ["working", record({ id: "33333333-3333-4333-8333-333333333333", hierarchyKind: "WORKING_FOLDER", category: "BAC", subcategory: "AGENDAS", logicalKey: "ADMIN|2027|BAC|AGENDAS|monthly reports" })],
  ]);
  const repository = { getActiveHierarchyFolderById: async (id: string) => entries.get(id) ?? null, listActiveHierarchyFolders: async () => [] };
  assert.deepEqual(await resolveUploadDestination("category", repository), { folderId: record().id, departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: 2027, category: "BACTI TEST", subcategory: null, logicalKey: "ADMIN|2027|BACTI TEST", driveFolderId: "fake-drive-id" });
  assert.equal((await resolveUploadDestination("subcategory", repository)).subcategory, "AGENDAS");
  assert.equal((await resolveUploadDestination("working", repository)).hierarchyKind, "WORKING_FOLDER");
});

test("rejects disabled, noncanonical, legacy, non-ADMIN, and missing destinations", async () => {
  const cases: Array<[string, HierarchyFolderRecord | null]> = [
    ["year", record({ hierarchyKind: "YEAR", category: null, logicalKey: "ADMIN|2027" })],
    ["disabled", record({ uploadEnabled: false })],
    ["accounting", record({ departmentKey: "ACCOUNTING" })],
    ["legacy", record({ hierarchyKind: null, departmentKey: null })],
    ["missing-drive", record({ driveFolderId: null })],
    ["bad-category", record({ category: null })],
    ["bad-subcategory", record({ hierarchyKind: "SUBCATEGORY", category: "BAC", subcategory: null })],
    ["missing", null],
  ];
  for (const [id, value] of cases) {
    await assert.rejects(() => resolveUploadDestination(id, { getActiveHierarchyFolderById: async () => value, listActiveHierarchyFolders: async () => [] }), UploadDestinationError);
  }
});

test("lists only enabled destinations in deterministic safe DTO order", async () => {
  const records = [
    record({ id: "working", hierarchyKind: "WORKING_FOLDER", category: "BAC", subcategory: "AGENDAS", name: "Monthly Reports", logicalKey: "ADMIN|2027|BAC|AGENDAS|monthly reports" }),
    record({ id: "disabled", uploadEnabled: false }),
    record({ id: "year", hierarchyKind: "YEAR", category: null, logicalKey: "ADMIN|2027" }),
    record({ id: "inactive", status: "FAILED" }),
    record({ id: "legacy", hierarchyKind: null, departmentKey: null }),
    record({ id: "accounting", departmentKey: "ACCOUNTING" }),
    record({ id: "category-2026", filingYear: 2026, category: "CONTRACTS", name: "CONTRACTS", logicalKey: "ADMIN|2026|CONTRACTS" }),
  ];
  const options = await listUploadDestinations({ getActiveHierarchyFolderById: async () => null, listActiveHierarchyFolders: async () => records });
  assert.deepEqual(options.map((option) => option.destinationId), ["working", "category-2026"]);
  const serialized = JSON.stringify(options);
  for (const key of ["driveFolderId", "driveParentId", "operationToken", "leaseExpiresAt", "fake-drive-id"]) assert.equal(serialized.includes(key), false);
});
