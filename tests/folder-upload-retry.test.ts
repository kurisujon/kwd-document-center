import assert from "node:assert/strict";
import test from "node:test";
import { classifyFolderUploadFailure, isFolderUploadRetryable } from "../src/lib/documents/folder-upload-retry.ts";

test("Folder retry classification exposes only bounded safe retry dispositions", () => {
  assert.deepEqual(classifyFolderUploadFailure(undefined), { disposition: "RETRYABLE", message: "Upload could not be confirmed. You can safely retry this file." });
  assert.equal(classifyFolderUploadFailure({ status: 503, code: "REGISTRY_ERROR" }).disposition, "RETRYABLE");
  assert.equal(classifyFolderUploadFailure({ status: 429 }).disposition, "RETRYABLE");
  assert.equal(classifyFolderUploadFailure({ status: 409 }).disposition, "BLOCKED");
  assert.equal(classifyFolderUploadFailure({ status: 400, code: "VALIDATION_ERROR" }).disposition, "NEEDS_ATTENTION");
  assert.equal(classifyFolderUploadFailure({ status: 401 }).disposition, "AUTH_ATTENTION");
  assert.equal(classifyFolderUploadFailure({ status: 403 }).disposition, "AUTH_ATTENTION");
  assert.equal(isFolderUploadRetryable("RETRYABLE"), true);
  assert.equal(isFolderUploadRetryable("BLOCKED"), false);
});
