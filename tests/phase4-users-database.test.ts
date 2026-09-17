import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260917000000_phase4_user_management.sql",
  import.meta.url,
);
const privilegeHardeningMigrationUrl = new URL(
  "../supabase/migrations/20260917010000_harden_users_table_privileges.sql",
  import.meta.url,
);
const coalesceCorrectionMigrationUrl = new URL(
  "../supabase/migrations/20260917020000_fix_admin_update_user_coalesce.sql",
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, "utf8");
}

async function privilegeHardeningMigrationSql() {
  return readFile(privilegeHardeningMigrationUrl, "utf8");
}

async function coalesceCorrectionMigrationSql() {
  return readFile(coalesceCorrectionMigrationUrl, "utf8");
}

test("Phase 4 migration refuses unsafe existing authorization data", async () => {
  const migration = await migrationSql();

  assert.match(
    migration,
    /if exists \(\s*select 1\s*from public\.users\s*\) and not exists \(\s*select 1\s*from public\.users as u\s*where u\.role = 'ADMIN' and u\.status = 'ACTIVE'\s*\) then\s*raise exception using message = 'PHASE4_PREFLIGHT_ACTIVE_ADMIN_REQUIRED'/i,
    "an empty users table must be replay-safe, while a populated table must contain an ACTIVE ADMIN",
  );
  assert.match(migration, /email <> pg_catalog\.lower\(pg_catalog\.btrim\(u\.email\)\)/i);
  assert.match(migration, /group by pg_catalog\.lower\(pg_catalog\.btrim\(u\.email\)\)[\s\S]*having pg_catalog\.count\(\*\) > 1/i);
  assert.match(migration, /pg_catalog\.btrim\(u\.name\) = ''/i);
  assert.match(migration, /pg_catalog\.char_length\(u\.name\) > 120/i);
  assert.match(migration, /pg_catalog\.char_length\(u\.email\) > 254/i);
});

test("Phase 4 migration enforces canonical immutable email and database timestamps", async () => {
  const migration = await migrationSql();

  assert.match(migration, /drop constraint if exists users_email_lowercase/i);
  assert.match(migration, /constraint users_email_canonical[\s\S]*email = pg_catalog\.lower\(pg_catalog\.btrim\(email\)\)/i);
  assert.match(migration, /function public\.enforce_users_email_immutable\(\)[\s\S]*EMAIL_IMMUTABLE/i);
  assert.match(migration, /create trigger users_email_immutable_trg[\s\S]*before update of email on public\.users/i);
  assert.match(migration, /function public\.set_users_updated_at\(\)[\s\S]*new\.updated_at := pg_catalog\.now\(\)/i);
  assert.match(migration, /create trigger users_set_updated_at_trg[\s\S]*before update on public\.users/i);
});

test("Phase 4 RPCs are SECURITY DEFINER functions with fixed search paths and actor reauthorization", async () => {
  const migration = await migrationSql();

  for (const signature of [
    /function public\.admin_list_users\(actor_id uuid\)/i,
    /function public\.admin_create_user\([\s\S]*actor_id uuid/i,
    /function public\.admin_update_user\([\s\S]*actor_id uuid/i,
  ]) {
    assert.match(migration, signature);
  }

  assert.equal((migration.match(/language plpgsql\s+security definer/gi) ?? []).length, 3);
  assert.equal((migration.match(/set search_path = pg_catalog, public/gi) ?? []).length, 5);
  assert.equal((migration.match(/actor\.id = actor_id[\s\S]{0,160}actor\.role = 'ADMIN'[\s\S]{0,160}actor\.status = 'ACTIVE'/gi) ?? []).length, 3);
  assert.doesNotMatch(migration, /execute\s+(format|immediate)\b/i, "privileged RPCs must not use dynamic SQL");
});

test("Phase 4 mutations share one advisory transaction lock and enforce update invariants", async () => {
  const migration = await migrationSql();

  assert.equal((migration.match(/pg_advisory_xact_lock\(126400, 4\)/gi) ?? []).length, 2);
  assert.match(migration, /perform pg_catalog\.pg_advisory_xact_lock\(126400, 4\)[\s\S]*actor\.id = actor_id/i);
  assert.match(migration, /actor_id = target_id[\s\S]*SELF_MODIFICATION_FORBIDDEN/i);
  assert.match(migration, /p_role is null and p_status is null[\s\S]*VALIDATION_ERROR/i);
  assert.match(migration, /p_role not in \('ADMIN', 'STAFF', 'VIEWER'\)/i);
  assert.match(migration, /p_status not in \('ACTIVE', 'INACTIVE'\)/i);
  assert.match(migration, /where target\.id = target_id[\s\S]*for update/i);
  assert.match(migration, /USER_NOT_FOUND/);
  assert.match(migration, /active_admin_count <= 1[\s\S]*LAST_ACTIVE_ADMIN/i);
  assert.match(migration, /set role = final_role,[\s\S]*status = final_status/i);
  assert.doesNotMatch(migration, /set[\s\S]{0,120}(email|name)\s*=/i, "admin_update_user must not update email or name");
});

test("Phase 4 user creation canonicalizes bounded inputs and always creates ACTIVE users", async () => {
  const migration = await migrationSql();

  assert.match(migration, /canonical_email := pg_catalog\.lower\(pg_catalog\.btrim\(p_email\)\)/i);
  assert.match(migration, /canonical_name := pg_catalog\.btrim\(p_name\)/i);
  assert.match(migration, /char_length\(canonical_email\) > 254/i);
  assert.match(migration, /char_length\(canonical_name\) > 120/i);
  assert.match(migration, /insert into public\.users as created_user \(email, name, role, status\)[\s\S]*values \(canonical_email, canonical_name, p_role, 'ACTIVE'\)/i);
  assert.match(migration, /when unique_violation then[\s\S]*USER_ALREADY_EXISTS/i);
  assert.doesNotMatch(migration, /admin_create_user\([\s\S]{0,180}p_status/i);
});

test("Phase 4 table hardening preserves authenticated self-read and removes all other application-role table privileges", async () => {
  const phaseOne = await readFile(
    new URL("../supabase/migrations/20260907000000_create_authorized_users.sql", import.meta.url),
    "utf8",
  );
  const migration = await migrationSql();
  const privilegeHardeningMigration = await privilegeHardeningMigrationSql();

  assert.match(phaseOne, /create policy "Users can read their own authorization record"[\s\S]*for select to authenticated/i);
  assert.match(phaseOne, /grant select on public\.users to authenticated/i);
  assert.doesNotMatch(migration, /revoke\s+select\s+on(?:\s+table)?\s+public\.users/i);
  assert.match(migration, /revoke insert, update, delete on table public\.users\s+from anon, authenticated, service_role/i);
  assert.match(
    privilegeHardeningMigration,
    /revoke all privileges on table public\.users\s+from anon, authenticated, service_role/i,
    "anon must have no direct table privileges, and authenticated/service_role must lose INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER",
  );
  assert.match(
    privilegeHardeningMigration,
    /grant select on table public\.users to authenticated/i,
    "authenticated must retain only the SELECT privilege required by its self-read RLS policy",
  );
  assert.doesNotMatch(
    privilegeHardeningMigration,
    /grant\s+[\s\S]{0,120}\b(?:anon|service_role)\b/i,
    "the hardening migration must not grant direct users-table privileges to anon or service_role",
  );
  assert.doesNotMatch(
    privilegeHardeningMigration,
    /(?:create|alter|drop)\s+policy\b/i,
    "the existing authenticated self-read RLS policy must remain unchanged",
  );
});

test("Phase 4 RPC execution remains service_role-only after table privilege hardening", async () => {
  const migration = await migrationSql();
  const privilegeHardeningMigration = await privilegeHardeningMigrationSql();

  for (const signature of [
    "public.admin_list_users(uuid)",
    "public.admin_create_user(uuid, text, text, text)",
    "public.admin_update_user(uuid, uuid, text, text)",
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(migration, new RegExp(`revoke execute on function ${escaped}\\s+from public, anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant execute on function ${escaped} to service_role`, "i"));
  }

  assert.doesNotMatch(
    privilegeHardeningMigration,
    /\b(?:grant|revoke)\s+execute\b/i,
    "the table-hardening follow-up must not change Phase 4 RPC permissions",
  );
});

test("Phase 4 RPCs return only the explicit administration shape", async () => {
  const migration = await migrationSql();

  const explicitReturnShape = /returns table \(\s*id uuid,\s*email text,\s*name text,\s*role text,\s*status text,\s*created_at timestamptz,\s*updated_at timestamptz\s*\)/gi;
  assert.equal((migration.match(explicitReturnShape) ?? []).length, 3);

  assert.match(
    migration,
    /select\s+listed_user\.id,\s*listed_user\.email,\s*listed_user\.name,\s*listed_user\.role,\s*listed_user\.status,\s*listed_user\.created_at,\s*listed_user\.updated_at\s+from public\.users as listed_user\s+order by listed_user\.email asc, listed_user\.id asc/i,
  );
  assert.match(
    migration,
    /insert into public\.users as created_user \(email, name, role, status\)[\s\S]*returning\s+created_user\.id,\s*created_user\.email,\s*created_user\.name,\s*created_user\.role,\s*created_user\.status,\s*created_user\.created_at,\s*created_user\.updated_at/i,
  );
  assert.match(
    migration,
    /update public\.users as target[\s\S]*returning\s+target\.id,\s*target\.email,\s*target\.name,\s*target\.role,\s*target\.status,\s*target\.created_at,\s*target\.updated_at/i,
  );
  assert.doesNotMatch(migration, /returns\s+(?:setof\s+)?public\.users/i);
  assert.doesNotMatch(migration, /\b(?:select|returning)\s+(?:[a-z_][a-z0-9_]*\.)?\*/i);
});

test("Phase 4 admin_update_user correction uses valid COALESCE syntax and preserves its security boundary", async () => {
  const correction = await coalesceCorrectionMigrationSql();

  assert.match(
    correction,
    /create or replace function public\.admin_update_user\(\s*actor_id uuid,\s*target_id uuid,\s*p_role text default null,\s*p_status text default null\s*\)/i,
  );
  assert.doesNotMatch(correction, /pg_catalog\.coalesce\b/i);
  assert.match(correction, /final_role := coalesce\(p_role, target_role\)/i);
  assert.match(correction, /final_status := coalesce\(p_status, target_status\)/i);

  assert.match(
    correction,
    /returns table \(\s*id uuid,\s*email text,\s*name text,\s*role text,\s*status text,\s*created_at timestamptz,\s*updated_at timestamptz\s*\)/i,
  );
  assert.match(correction, /language plpgsql\s+security definer\s+set search_path = pg_catalog, public/i);
  assert.match(
    correction,
    /perform pg_catalog\.pg_advisory_xact_lock\(126400, 4\)[\s\S]*actor\.id = actor_id[\s\S]*actor\.role = 'ADMIN'[\s\S]*actor\.status = 'ACTIVE'/i,
  );
  assert.match(correction, /actor_id = target_id[\s\S]*SELF_MODIFICATION_FORBIDDEN/i);
  assert.match(correction, /p_role is null and p_status is null[\s\S]*VALIDATION_ERROR/i);
  assert.match(correction, /p_role not in \('ADMIN', 'STAFF', 'VIEWER'\)/i);
  assert.match(correction, /p_status not in \('ACTIVE', 'INACTIVE'\)/i);
  assert.match(correction, /where target\.id = target_id\s+for update/i);
  assert.match(correction, /USER_NOT_FOUND/);
  assert.match(correction, /active_admin_count <= 1[\s\S]*LAST_ACTIVE_ADMIN/i);
  assert.match(correction, /set role = final_role,\s*status = final_status/i);
  assert.doesNotMatch(correction, /set[\s\S]{0,120}(email|name)\s*=/i);
  assert.match(
    correction,
    /returning\s+target\.id,\s*target\.email,\s*target\.name,\s*target\.role,\s*target\.status,\s*target\.created_at,\s*target\.updated_at/i,
  );

  assert.match(
    correction,
    /revoke execute on function public\.admin_update_user\(uuid, uuid, text, text\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    correction,
    /grant execute on function public\.admin_update_user\(uuid, uuid, text, text\)\s+to service_role/i,
  );
});

test("Phase 4 corrective SQL contains no other schema-qualified syntax-only constructs", async () => {
  const privilegeHardeningMigration = await privilegeHardeningMigrationSql();
  const correction = await coalesceCorrectionMigrationSql();
  const forwardOnlyCorrections = `${privilegeHardeningMigration}\n${correction}`;

  assert.doesNotMatch(
    forwardOnlyCorrections,
    /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/i,
  );
});
