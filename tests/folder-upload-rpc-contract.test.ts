import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20261007000000_add_folder_upload_claim_finalize_rpc.sql", import.meta.url);
const schemaMigrationUrl = new URL("../supabase/migrations/20261006000000_add_folder_upload_provenance_reservations.sql", import.meta.url);

function isValidIsoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function isValidFolderUploadSize(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4_194_304;
}

test("folder-upload RPC migration implements a hardened claim and atomic finalization lifecycle", async () => {
  const [sql, schemaSql] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(schemaMigrationUrl, "utf8")]);
  assert.match(schemaSql, /upload_attempts_folder_destination_path_unique_idx/i);
  const claim = sql.match(/create or replace function public\.admin_claim_folder_upload_attempt\([\s\S]*?\$\$;/i)?.[0] ?? "";
  const finalize = sql.match(/create or replace function public\.admin_finalize_folder_upload\([\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.ok(claim);
  assert.ok(finalize);
  for (const rpc of [claim, finalize]) {
    assert.match(rpc, /security definer[\s\S]*set search_path = public, pg_catalog/i);
  }
  assert.doesNotMatch(sql, /pg_catalog\.coalesce/i);
  assert.match(claim, /coalesce\(p_metadata_snapshot ->> 'file_name', ''\)/i);
  assert.match(claim, /actor\.status = 'ACTIVE'[\s\S]*actor\.role in \('STAFF', 'ADMIN'\)/i);
  const idempotencyLookup = claim.match(/select \* into target[\s\S]*?for update;/i)?.[0] ?? "";
  const destinationLookup = claim.match(/select \* into destination[\s\S]*?for update;/i)?.[0] ?? "";
  const newRequestValidation = claim.indexOf("if p_idempotency_key is null");
  assert.ok(claim.indexOf(idempotencyLookup) < claim.indexOf(destinationLookup), "existing idempotency replay must precede new-destination eligibility");
  assert.ok(claim.indexOf(idempotencyLookup) < newRequestValidation, "existing idempotency replay must precede new-request snapshot validation");
  const replayBlock = claim.match(/if found then[\s\S]*?return;\n  end if;[\s\S]*?select \* into destination/i)?.[0] ?? "";
  assert.doesNotMatch(replayBlock, /destination\.(?:status|upload_enabled|department_key|hierarchy_kind|drive_folder_id)/i);
  const newDestinationBlock = claim.slice(claim.indexOf(destinationLookup));
  assert.match(newDestinationBlock, /destination\.status <> 'ACTIVE'[\s\S]*destination\.upload_enabled is not true/i);
  assert.match(claim, /from public\.document_folders[\s\S]*for update/i);
  for (const condition of ["destination.status <> 'ACTIVE'", "destination.department_key <> 'ADMIN'", "destination.hierarchy_kind not in ('CATEGORY', 'SUBCATEGORY', 'WORKING_FOLDER')", "destination.upload_enabled is not true", "destination.drive_folder_id is null", "destination.filing_year is null", "destination.category is null"]) assert.match(claim, new RegExp(condition.replace(/[()]/g, "\\$&"), "i"));
  assert.match(claim, /select \* into target[\s\S]*idempotency_key = p_idempotency_key[\s\S]*for update/i);
  const identity = claim.match(/if target\.created_by is distinct from p_actor_id[\s\S]*?then[\s\S]*?'IDEMPOTENCY_MISMATCH'/i)?.[0] ?? "";
  for (const [column, parameter] of [["created_by", "p_actor_id"], ["destination_folder_id", "p_destination_folder_id"], ["source_relative_path", "p_source_relative_path"], ["normalized_relative_path_key", "p_normalized_relative_path_key"], ["content_sha256", "p_content_sha256"], ["metadata_snapshot", "p_metadata_snapshot"]] as const) assert.match(identity, new RegExp(`target\\.${column}\\s+is distinct from\\s+${parameter}`, "i"));
  assert.match(claim, /'DUPLICATE_PATH'/i);
  assert.match(claim, /exception when unique_violation/i);
  for (const field of ["document_type", "document_number", "document_date", "subject", "persons_involved", "filing_year", "filing_subcategory", "file_name", "file_type", "file_size"]) assert.match(claim, new RegExp(`p_metadata_snapshot \\? '${field}'`, "i"));
  assert.match(claim, /snapshot_document_date_text !~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$'/i);
  assert.match(claim, /snapshot_document_date := snapshot_document_date_text::date/i);
  assert.match(claim, /when datetime_field_overflow or invalid_datetime_format/i);
  assert.match(claim, /to_char\(snapshot_document_date, 'YYYY-MM-DD'\) <> snapshot_document_date_text/i);
  const fileSizeTypeCheck = claim.indexOf("jsonb_typeof(p_metadata_snapshot -> 'file_size') <> 'number'");
  const fileSizeSyntaxCheck = claim.indexOf("snapshot_file_size_text !~ '^[1-9][0-9]*$'");
  const fileSizeLengthCheck = claim.indexOf("char_length(snapshot_file_size_text) > 7");
  const fileSizeConversion = claim.indexOf("snapshot_file_size := snapshot_file_size_text::integer");
  const fileSizeRangeCheck = claim.indexOf("snapshot_file_size < 1 or snapshot_file_size > 4194304");
  assert.ok(fileSizeTypeCheck >= 0 && fileSizeSyntaxCheck > fileSizeTypeCheck && fileSizeLengthCheck > fileSizeSyntaxCheck && fileSizeConversion > fileSizeLengthCheck && fileSizeRangeCheck > fileSizeConversion, "file size must be type-checked, syntax-checked, length-bounded, converted, then range-checked");
  assert.doesNotMatch(claim, /or\s+snapshot_file_size_text::integer/i);
  assert.match(claim, /p_metadata_snapshot ->> 'document_type'\) is distinct from destination\.category/i);
  assert.match(claim, /p_metadata_snapshot ->> 'filing_year'\) is distinct from destination\.filing_year::text/i);
  assert.match(claim, /p_metadata_snapshot ->> 'filing_subcategory'\) is distinct from coalesce\(destination\.subcategory, ''\)/i);
  assert.doesNotMatch(claim, /destination_folder_id, normalized_relative_path_key\)[\s\S]*where[\s\S]*status/i);
  assert.match(finalize, /select \* into locked_attempt[\s\S]*where id = p_attempt_id[\s\S]*for update/i);
  assert.match(finalize, /locked_attempt\.status = 'COMPLETE'[\s\S]*locked_attempt\.document_id is not null/i);
  assert.match(finalize, /locked_attempt\.status <> 'PENDING_REGISTRY'/i);
  assert.match(finalize, /locked_attempt\.drive_file_id is distinct from p_expected_drive_file_id/i);
  assert.match(finalize, /locked_attempt\.destination_folder_id, locked_attempt\.source_relative_path/i);
  assert.match(finalize, /set status = 'COMPLETE', document_id = created_document\.document_id/i);
  assert.doesNotMatch(finalize, /upload_enabled/i);
  assert.doesNotMatch(sql, /create or replace function public\.finalize_admin_upload/i);
  assert.doesNotMatch(sql, /create table|update public\.(?!upload_attempts)|delete from|drop table|drop column|create policy|alter policy/i);
});

test("folder-upload RPCs are service-role-only and leave legacy contracts untouched", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const functionName of ["admin_claim_folder_upload_attempt", "admin_finalize_folder_upload"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}[\\s\\S]*from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*to service_role`, "i"));
  }
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (?:anon|authenticated|public)/i);
  assert.doesNotMatch(sql, /files\.create|files\.get|files\.list|permissions\./i);
});

test("folder-upload metadata contract names accepted and rejected date and file-size boundary cases", () => {
  for (const value of ["2026-10-06", "2024-02-29"]) assert.equal(isValidIsoDate(value), true, value);
  for (const value of ["2026-02-29", "2026-13-01", "2026-01-32", "not-a-date", "", 20261006, undefined]) assert.equal(isValidIsoDate(value), false, String(value));
  for (const value of [1, 1024, 4_194_304]) assert.equal(isValidFolderUploadSize(value), true, String(value));
  for (const value of [0, -1, 1.5, 4_194_305, "1024", undefined, Number.MAX_SAFE_INTEGER]) assert.equal(isValidFolderUploadSize(value), false, String(value));
});
