import assert from "node:assert/strict";
import test from "node:test";
import { createFolderUploadAttemptRepository, FolderUploadAttemptRepositoryError } from "../src/lib/documents/upload-repository.ts";

const input = {
  actorId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  destinationFolderId: "33333333-3333-4333-8333-333333333333",
  sourceRelativePath: "Reports/January/report.pdf",
  normalizedRelativePathKey: "reports/january/report.pdf",
  contentSha256: new Uint8Array(32).fill(7),
  metadataSnapshot: { document_type: "BACTI TEST", document_number: "", document_date: "2027-01-01", subject: "Report", persons_involved: "", filing_year: 2027, filing_subcategory: "", file_name: "report.pdf", file_type: "application/pdf", file_size: 4 },
};

test("folder claim repository maps only bounded RPC outcomes and trusted RPC arguments", async () => {
  for (const outcome of ["CLAIMED", "REPLAY", "COMPLETE", "DUPLICATE_PATH", "IDEMPOTENCY_MISMATCH", "NOT_AUTHORIZED", "INVALID_DESTINATION", "INVALID_REQUEST"] as const) {
    let rpcName = "";
    let rpcArgs: Record<string, unknown> = {};
    const repository = createFolderUploadAttemptRepository({ rpc: async (name: string, args: Record<string, unknown>) => {
      rpcName = name; rpcArgs = args;
      return { data: [{ outcome, attempt_id: "attempt", attempt_status: outcome === "COMPLETE" ? "COMPLETE" : "PENDING_UPLOAD", drive_file_id: "internal-drive-id", operation_token: "token", reservation_expires_at: null, document_id: outcome === "COMPLETE" ? "document" : null }], error: null };
    } } as never);
    const result = await repository.claimFolderUploadAttempt(input);
    assert.equal(result.outcome, outcome);
    assert.equal(rpcName, "admin_claim_folder_upload_attempt");
    assert.equal(rpcArgs.p_actor_id, input.actorId);
    assert.equal(rpcArgs.p_destination_folder_id, input.destinationFolderId);
    assert.equal(rpcArgs.p_source_relative_path, input.sourceRelativePath);
    assert.equal(rpcArgs.p_normalized_relative_path_key, input.normalizedRelativePathKey);
    assert.equal(rpcArgs.p_content_sha256, `\\x${"07".repeat(32)}`);
    assert.deepEqual(rpcArgs.p_metadata_snapshot, input.metadataSnapshot);
  }
});

test("folder finalize repository uses the dedicated RPC and hides raw database diagnostics", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const repository = createFolderUploadAttemptRepository({ rpc: async (name: string, args: Record<string, unknown>) => {
    rpcName = name; rpcArgs = args;
    return { data: { document_id: "document", drive_file_id: "internal-drive-id" }, error: null };
  } } as never);
  const document = await repository.finalizeFolderUploadAttempt({ attemptId: "attempt", actorId: input.actorId, expectedDriveFileId: "internal-drive-id" });
  assert.equal(document.document_id, "document");
  assert.equal(rpcName, "admin_finalize_folder_upload");
  assert.deepEqual(rpcArgs, { p_attempt_id: "attempt", p_actor_id: input.actorId, p_expected_drive_file_id: "internal-drive-id" });
  const failed = createFolderUploadAttemptRepository({ rpc: async () => ({ data: null, error: { message: "internal SQL diagnostic" } }) } as never);
  await assert.rejects(() => failed.claimFolderUploadAttempt(input), (error: unknown) => error instanceof FolderUploadAttemptRepositoryError && !error.message.includes("diagnostic"));
  await assert.rejects(() => failed.finalizeFolderUploadAttempt({ attemptId: "attempt", actorId: input.actorId, expectedDriveFileId: "internal-drive-id" }), (error: unknown) => error instanceof FolderUploadAttemptRepositoryError && !error.message.includes("diagnostic"));
  const malformed = createFolderUploadAttemptRepository({ rpc: async () => ({ data: [{ outcome: "CLAIMED", attempt_id: null, attempt_status: null }], error: null }) } as never);
  await assert.rejects(() => malformed.claimFolderUploadAttempt(input), FolderUploadAttemptRepositoryError);
  const malformedFinalize = createFolderUploadAttemptRepository({ rpc: async () => ({ data: { drive_file_id: "internal-drive-id" }, error: null }) } as never);
  await assert.rejects(() => malformedFinalize.finalizeFolderUploadAttempt({ attemptId: "attempt", actorId: input.actorId, expectedDriveFileId: "internal-drive-id" }), FolderUploadAttemptRepositoryError);
});
