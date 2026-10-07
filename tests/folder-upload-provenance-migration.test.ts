import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20261006000000_add_folder_upload_provenance_reservations.sql", import.meta.url);
const hierarchyMigrationUrl = new URL("../supabase/migrations/20261002000000_extend_document_folders_hierarchy.sql", import.meta.url);

test("folder-upload provenance migration is additive, nullable for legacy rows, and reserves destination paths", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.documents[\s\S]*add column destination_folder_id uuid[\s\S]*add column source_relative_path text/i);
  assert.match(sql, /alter table public\.upload_attempts[\s\S]*add column destination_folder_id uuid[\s\S]*add column source_relative_path text[\s\S]*add column normalized_relative_path_key text[\s\S]*add column content_sha256 bytea/i);
  assert.match(sql, /documents_destination_folder_id_fkey[\s\S]*references public\.document_folders\(id\) on delete restrict/i);
  assert.match(sql, /upload_attempts_destination_folder_id_fkey[\s\S]*references public\.document_folders\(id\) on delete restrict/i);
  const documentPair = sql.match(/documents_folder_upload_provenance_pair_chk[\s\S]*?\);/i)?.[0] ?? "";
  assert.match(documentPair, /destination_folder_id is null and source_relative_path is null/i);
  assert.match(documentPair, /destination_folder_id is not null[\s\S]*source_relative_path is not null/i);
  assert.match(documentPair, /source_relative_path <> ''/i);
  assert.match(documentPair, /octet_length\(source_relative_path\) <= 1024/i);
  const attemptShape = sql.match(/upload_attempts_folder_upload_provenance_shape_chk[\s\S]*?\);/i)?.[0] ?? "";
  for (const column of ["destination_folder_id", "source_relative_path", "normalized_relative_path_key", "content_sha256"]) {
    assert.match(attemptShape, new RegExp(`${column} is null`, "i"));
    assert.match(attemptShape, new RegExp(`${column} is not null`, "i"));
  }
  assert.match(attemptShape, /source_relative_path <> ''/i);
  assert.match(attemptShape, /normalized_relative_path_key <> ''/i);
  assert.match(attemptShape, /octet_length\(source_relative_path\) <= 1024/i);
  assert.match(attemptShape, /octet_length\(normalized_relative_path_key\) <= 1024/i);
  assert.match(attemptShape, /octet_length\(content_sha256\) = 32/i);
  const uniqueIndex = sql.match(/create unique index upload_attempts_folder_destination_path_unique_idx[\s\S]*?;/i)?.[0] ?? "";
  assert.match(uniqueIndex, /on public\.upload_attempts \(destination_folder_id, normalized_relative_path_key\)/i);
  assert.match(uniqueIndex, /where destination_folder_id is not null[\s\S]*normalized_relative_path_key is not null/i);
  assert.doesNotMatch(uniqueIndex, /content_sha256|status/i);
  assert.doesNotMatch(sql, /create table|update public\.|delete from|drop table|drop column|create or replace function|grant |revoke |create policy|alter policy/i);
});

test("folder-upload provenance migration leaves frozen hierarchy and legacy upload contracts untouched", async () => {
  const [folderUploadSql, hierarchySql] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(hierarchyMigrationUrl, "utf8")]);
  assert.doesNotMatch(hierarchySql, /destination_folder_id|source_relative_path|normalized_relative_path_key|content_sha256/i);
  assert.doesNotMatch(folderUploadSql, /idempotency_key|finalize_admin_upload|admin_claim|drive_folder_id|drive_file_id/i);
  assert.doesNotMatch(folderUploadSql, /google|files\.create|files\.list|permissions\./i);
});
