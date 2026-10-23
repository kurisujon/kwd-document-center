import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hierarchy migrations preserve the RPC boundary and harden nullable hierarchy identity", async () => {
  const [folderSql, hierarchySql, hardeningSql] = await Promise.all([
    readFile(new URL("../supabase/migrations/20261001000000_add_document_folders.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20261002000000_extend_document_folders_hierarchy.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20261016000000_harden_document_folder_hierarchy_integrity.sql", import.meta.url), "utf8"),
  ]);
  const sql = `${folderSql}\n${hierarchySql}\n${hardeningSql}`;
  for (const fn of ["admin_claim_hierarchy_folder_creation", "admin_register_static_document_folder"]) {
    assert.match(hardeningSql, new RegExp(`create or replace function public\\.${fn}`, "i"));
    assert.match(hardeningSql, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*from public, anon, authenticated`, "i"));
    assert.match(hardeningSql, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*to service_role`, "i"));
  }
  for (const fn of ["admin_set_document_folder_drive_id", "admin_finalize_document_folder_creation", "admin_mark_document_folder_failed", "admin_register_static_document_folder"]) {
    assert.match(sql, new RegExp(`function public\\.${fn}`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*from public, anon, authenticated`, "i"));
  }
  assert.match(sql, /drive_folder_id is null or drive_folder_id=p_drive_folder_id/i);
  assert.match(sql, /status='CREATING' and operation_token=p_operation_token/i);
  assert.match(sql, /'ACTIVE',null,null,p_actor_id,null,p_upload_enabled,'STATIC'/i);
  assert.match(sql, /STATIC_ID_MISMATCH|STATIC_DRIVE_ID_CONFLICT/);
  assert.match(sql, /security definer set search_path = public, pg_catalog/i);
  assert.match(sql, /actor\.role='ADMIN' and actor\.status='ACTIVE'/i);
  assert.doesNotMatch(sql.split("create or replace function", 1)[0], /lease_expires_at\s*>\s*now\(\)/i);
  const claimRpc = hardeningSql.match(/create or replace function public\.admin_claim_hierarchy_folder_creation\([\s\S]*?end; \$\$;/i)?.[0] ?? "";
  const identityCheck = claimRpc.match(/if target\.created_by is distinct from p_actor_id[\s\S]*?then raise exception 'IDEMPOTENCY_MISMATCH'; end if;/i)?.[0] ?? "";
  assert.ok(identityCheck, "same-key hierarchy claims must compare complete request identity before replay handling");
  for (const [column, parameter] of [["created_by", "p_actor_id"], ["department_key", "p_department_key"], ["hierarchy_kind", "p_hierarchy_kind"], ["parent_folder_id", "p_parent_folder_id"], ["logical_parent_key", "p_logical_parent_key"], ["drive_parent_id", "p_drive_parent_id"], ["filing_year", "p_filing_year"], ["category", "p_category"], ["subcategory", "p_subcategory"], ["logical_key", "p_logical_key"], ["name", "p_name"], ["normalized_name", "p_normalized_name"]] as const) {
    assert.match(identityCheck, new RegExp(`target\\.${column}\\s+is distinct from\\s+${parameter}`, "i"));
  }
  assert.doesNotMatch(identityCheck, /target\.(status|operation_token|lease_expires_at|drive_folder_id|error_category|created_at|updated_at)\s+is distinct from/i);
  assert.match(claimRpc, /p_department_key is distinct from v_parent\.department_key/i);
  assert.match(claimRpc, /p_drive_parent_id is distinct from v_parent\.drive_folder_id/i);
  assert.match(claimRpc, /p_hierarchy_kind is null or p_hierarchy_kind not in/i);
  assert.match(claimRpc, /v_parent\.hierarchy_kind is distinct from 'YEAR'/i);
  assert.match(claimRpc, /v_parent\.hierarchy_kind is distinct from 'CATEGORY'/i);
  assert.match(claimRpc, /p_filing_year is distinct from v_parent\.filing_year/i);
  assert.match(claimRpc, /p_category is distinct from v_parent\.category/i);
  assert.match(claimRpc, /p_subcategory is distinct from v_parent\.subcategory/i);
  assert.doesNotMatch(claimRpc, /p_department_key<>v_parent\.department_key/i);
  assert.match(claimRpc, /if target\.status='ACTIVE' then return query select 'ACTIVE'/i);
  assert.match(claimRpc, /target\.status='CREATING' and target\.lease_expires_at>now\(\)/i);
  const staticRpc = hardeningSql.match(/create or replace function public\.admin_register_static_document_folder\([\s\S]*?end; \$\$;/i)?.[0] ?? "";
  assert.match(staticRpc, /security definer set search_path = public, pg_catalog/i);
  assert.match(staticRpc, /actor\.role='ADMIN' and actor\.status='ACTIVE'/i);
  assert.match(staticRpc, /p_hierarchy_kind='YEAR'[\s\S]*p_parent_folder_id is not null[\s\S]*p_category is not null[\s\S]*p_subcategory is not null/i);
  assert.match(staticRpc, /select \* into v_parent from public\.document_folders where id=p_parent_folder_id for update/i);
  assert.match(staticRpc, /v_parent\.status<>'ACTIVE' or v_parent\.drive_folder_id is null/i);
  assert.match(staticRpc, /p_drive_parent_id is distinct from v_parent\.drive_folder_id or p_department_key is distinct from v_parent\.department_key/i);
  assert.match(staticRpc, /p_hierarchy_kind is null or p_hierarchy_kind not in/i);
  assert.match(staticRpc, /v_parent\.hierarchy_kind is distinct from 'YEAR'/i);
  assert.match(staticRpc, /v_parent\.hierarchy_kind is distinct from 'CATEGORY'/i);
  assert.match(staticRpc, /v_parent\.hierarchy_kind='CATEGORY'/i);
  assert.match(staticRpc, /v_parent\.hierarchy_kind='SUBCATEGORY'/i);
  const staticReplay = staticRpc.match(/if target\.status<>'ACTIVE'[\s\S]*?then raise exception 'STATIC_ID_MISMATCH'; end if;/i)?.[0] ?? "";
  assert.ok(staticReplay, "static logical-key replay must validate the complete canonical row");
  assert.match(staticReplay, /target\.source is distinct from 'STATIC'/i);
  assert.match(staticReplay, /target\.drive_folder_id is null/i);
  for (const [column, parameter] of [["drive_folder_id", "p_drive_folder_id"], ["parent_folder_id", "p_parent_folder_id"], ["logical_parent_key", "p_logical_parent_key"], ["drive_parent_id", "p_drive_parent_id"], ["department_key", "p_department_key"], ["hierarchy_kind", "p_hierarchy_kind"], ["filing_year", "p_filing_year"], ["category", "p_category"], ["subcategory", "p_subcategory"], ["name", "p_name"], ["normalized_name", "p_normalized_name"]] as const) {
    assert.match(staticReplay, new RegExp(`target\\.${column}\\s+is distinct from\\s+${parameter}`, "i"));
  }
  assert.match(staticRpc, /'ACTIVE',null,null,p_actor_id,null,p_upload_enabled,'STATIC'/i);
  assert.match(staticRpc, /STATIC_ID_MISMATCH|STATIC_DRIVE_ID_CONFLICT/);
  assert.match(sql, /document_folders_active_child_name_idx/);
  assert.doesNotMatch(sql, /files\.list|files\.create|files\.delete|permissions\./i);
});
