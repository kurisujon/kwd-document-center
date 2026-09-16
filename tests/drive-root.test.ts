import assert from "node:assert/strict";
import test from "node:test";
import type { drive_v3 } from "googleapis";
import { ensureRootDriveFolder } from "../src/lib/google/drive-root.ts";
import { DriveServiceError } from "../src/lib/google/drive-types.ts";

function fakeDrive(listResult: unknown, createResult?: unknown) {
  let creates = 0;
  const drive = {
    files: {
      async list() { return { data: listResult }; },
      async create(input: unknown) { creates += 1; return { data: createResult, input }; },
    },
  } as unknown as drive_v3.Drive;
  return { drive, creates: () => creates };
}

test("root provisioning returns an existing root folder without creating another", async () => {
  const mock = fakeDrive({ files: [{ id: "existingRootId_123", name: "KWD Document Center", trashed: false }] });
  assert.equal(await ensureRootDriveFolder(mock.drive), "existingRootId_123");
  assert.equal(mock.creates(), 0);
});

test("root provisioning creates the approved root folder when absent", async () => {
  const mock = fakeDrive({ files: [] }, { id: "createdRootId_123", name: "KWD Document Center", trashed: false });
  assert.equal(await ensureRootDriveFolder(mock.drive), "createdRootId_123");
  assert.equal(mock.creates(), 1);
});

test("root provisioning classifies provider failures safely", async () => {
  const drive = { files: { async list() { throw Object.assign(new Error("secret-refresh-token"), { code: 503 }); } } } as unknown as drive_v3.Drive;
  await assert.rejects(() => ensureRootDriveFolder(drive), (error: unknown) => {
    assert.ok(error instanceof DriveServiceError);
    assert.equal(error.kind, "TRANSIENT");
    assert.doesNotMatch(error.message, /secret-refresh-token/);
    return true;
  });
});
