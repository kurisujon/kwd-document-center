import assert from "node:assert/strict";
import test from "node:test";
import { getAdminDriveFolderId, DriveConfigurationError } from "../src/lib/documents/drive-config.ts";

const category = "BACTI TEST" as const;

function withConfig<T>(map: string | undefined, root: string | undefined, operation: () => T): T {
  const previousMap = process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP;
  const previousRoot = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (map === undefined) delete process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP; else process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = map;
  if (root === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID; else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = root;
  try { return operation(); } finally {
    if (previousMap === undefined) delete process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP; else process.env.GOOGLE_DRIVE_ADMIN_FOLDER_MAP = previousMap;
    if (previousRoot === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID; else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = previousRoot;
  }
}

test("Drive config prefers a valid mapped logical folder", () => withConfig(JSON.stringify({ "ADMIN|2026|BACTI TEST": "mappedFolderId_123" }), "rootFolderId_123", () => {
  assert.equal(getAdminDriveFolderId(category, 2026, ""), "mappedFolderId_123");
}));

test("Drive config falls back to the root folder when the map is empty", () => withConfig("", "rootFolderId_123", () => {
  assert.equal(getAdminDriveFolderId(category, 2026, ""), "rootFolderId_123");
}));

test("Drive config keeps the safe configuration error when both destinations are missing", () => withConfig(undefined, undefined, () => {
  assert.throws(() => getAdminDriveFolderId(category, 2026, ""), (error: unknown) => error instanceof DriveConfigurationError);
}));
