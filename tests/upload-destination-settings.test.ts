import assert from "node:assert/strict";
import test from "node:test";
import type { HierarchyFolderRecord } from "../src/lib/documents/hierarchy-repository.ts";
import { listUploadDestinationSettings, setUploadDestinationEnabled } from "../src/lib/documents/upload-destination-settings.ts";
import { resolveUploadDestination } from "../src/lib/documents/upload-destination.ts";

const record = (overrides: Partial<HierarchyFolderRecord> = {}): HierarchyFolderRecord => ({
  id: "11111111-1111-4111-8111-111111111111", idempotencyKey: "key", logicalParentKey: "ADMIN|2027", parentFolderId: "parent-id",
  departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: 2027, category: "BACTI TEST", subcategory: null,
  logicalKey: "ADMIN|2027|BACTI TEST", name: "BACTI TEST", normalizedName: "bacti test", source: "DYNAMIC", status: "ACTIVE",
  driveParentId: "fake-parent-drive-id", driveFolderId: "fake-drive-id", uploadEnabled: false, operationToken: null, leaseExpiresAt: null,
  createdBy: "actor", errorCategory: null, createdAt: "2026-10-05", updatedAt: "2026-10-05", ...overrides,
});

test("settings list includes only canonical ACTIVE ADMIN uploadable hierarchy nodes in deterministic safe order", async () => {
  const rows = [
    record({ id: "working", hierarchyKind: "WORKING_FOLDER", category: "BAC", subcategory: "AGENDAS", name: "Monthly Reports", logicalKey: "ADMIN|2027|BAC|AGENDAS|monthly" }),
    record({ id: "subcategory", hierarchyKind: "SUBCATEGORY", category: "BAC", subcategory: "AGENDAS", logicalKey: "ADMIN|2027|BAC|AGENDAS", uploadEnabled: true }),
    record({ id: "year", hierarchyKind: "YEAR", category: null, logicalKey: "ADMIN|2027" }),
    record({ id: "inactive", status: "FAILED" }),
    record({ id: "legacy", hierarchyKind: null, departmentKey: null }),
    record({ id: "accounting", departmentKey: "ACCOUNTING" }),
    record({ id: "bad", hierarchyKind: "CATEGORY", subcategory: "unexpected" }),
  ];
  const settings = await listUploadDestinationSettings({ listActiveHierarchyFolders: async () => rows, setHierarchyUploadEnabled: async () => null });
  assert.deepEqual(settings.map((setting) => setting.destinationId), ["subcategory", "working"]);
  assert.equal(settings[0]?.uploadEnabled, true);
  assert.equal(settings[1]?.displayName, "2027 / BAC / AGENDAS / Monthly Reports");
  const serialized = JSON.stringify(settings);
  for (const field of ["driveFolderId", "driveParentId", "operationToken", "lease", "fake-drive-id"]) assert.equal(serialized.includes(field), false);
});

test("settings mutation supports enabled hierarchy kinds, same-value idempotency, and rejects invalid canonical rows", async () => {
  const captures: Array<{ folderId: string; uploadEnabled: boolean }> = [];
  for (const hierarchyKind of ["CATEGORY", "SUBCATEGORY", "WORKING_FOLDER"] as const) {
    const value = record({ hierarchyKind, category: hierarchyKind === "CATEGORY" ? "BACTI TEST" : "BAC", subcategory: hierarchyKind === "SUBCATEGORY" ? "AGENDAS" : null });
    const setting = await setUploadDestinationEnabled(value.id, true, {
      listActiveHierarchyFolders: async () => [],
      setHierarchyUploadEnabled: async (input) => { captures.push(input); return { ...value, uploadEnabled: input.uploadEnabled }; },
    });
    assert.equal(setting?.uploadEnabled, true);
  }
  const sameValue = await setUploadDestinationEnabled("same", false, {
    listActiveHierarchyFolders: async () => [],
    setHierarchyUploadEnabled: async (input) => record({ id: input.folderId, uploadEnabled: input.uploadEnabled }),
  });
  assert.equal(sameValue?.uploadEnabled, false);
  assert.equal(captures.length, 3);

  const invalidRows = [
    record({ hierarchyKind: "YEAR", category: null, logicalKey: "ADMIN|2027", uploadEnabled: true }),
    record({ status: "FAILED" }), record({ departmentKey: "ACCOUNTING" }), record({ departmentKey: "PRE-POST" }), record({ hierarchyKind: null, departmentKey: null }),
    record({ driveFolderId: null }), record({ category: null }), record({ hierarchyKind: "SUBCATEGORY", category: "BAC", subcategory: null }),
    record({ hierarchyKind: "WORKING_FOLDER", category: null }),
  ];
  for (const invalid of invalidRows) {
    assert.equal(await setUploadDestinationEnabled(invalid.id, true, { listActiveHierarchyFolders: async () => [], setHierarchyUploadEnabled: async () => invalid }), null);
  }
});

test("activation state remains authoritative for the existing upload destination resolver", async () => {
  const enabled = record({ uploadEnabled: true });
  assert.equal((await resolveUploadDestination(enabled.id, { getActiveHierarchyFolderById: async () => enabled, listActiveHierarchyFolders: async () => [] })).folderId, enabled.id);
  const disabled = record({ uploadEnabled: false });
  await assert.rejects(() => resolveUploadDestination(disabled.id, { getActiveHierarchyFolderById: async () => disabled, listActiveHierarchyFolders: async () => [] }));
});
