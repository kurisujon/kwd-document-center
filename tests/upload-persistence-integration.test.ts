import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertDisposableLocalDatabase } from "./helpers/disposable-local-db.ts";

const databaseUrl = process.env.KWD_UPLOAD_TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl && process.env.KWD_ALLOW_DESTRUCTIVE_LOCAL_DB === "YES");
const migrationFiles = [
  "20260907000000_create_authorized_users.sql",
  "20260908000000_create_document_registry.sql",
  "20260909000000_add_admin_drive_uploads.sql",
  "20260915000000_grant_service_role_documents_select.sql",
  "20260917000000_phase4_user_management.sql",
  "20260917010000_harden_users_table_privileges.sql",
  "20260917020000_fix_admin_update_user_coalesce.sql",
].map((file) => fileURLToPath(new URL(`../supabase/migrations/${file}`, import.meta.url)));

type PsqlResult = { code: number | null; stdout: string; stderr: string; elapsedMs: number };

function psql(url: string, args: string[]) {
  const startedAt = Date.now();
  const child = spawn("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--dbname", url, ...args], { env: { ...process.env, PGCONNECT_TIMEOUT: "5" } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return {
    child,
    result: new Promise<PsqlResult>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr, elapsedMs: Date.now() - startedAt }));
    }),
    stdout: () => stdout,
  };
}

function literal(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function lastValue(result: PsqlResult) { return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ""; }
function databaseUrlFor(urlValue: string, databaseName: string) { const url = new URL(urlValue); url.pathname = `/${databaseName}`; return url.toString(); }

async function success(url: string, sql: string) {
  const result = await psql(url, ["--command", sql]).result;
  assert.equal(result.code, 0, result.stderr);
  return result;
}

async function failure(url: string, sql: string, pattern: RegExp) {
  const result = await psql(url, ["--command", sql]).result;
  assert.notEqual(result.code, 0, "operation must fail");
  assert.match(result.stderr, pattern);
}

async function waitForOutput(readOutput: () => string, expected: string) {
  const deadline = Date.now() + 5_000;
  while (!readOutput().includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${expected}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test(
  "migrated local upload persistence and finalization preserve one document per attempt",
  { skip: integrationEnabled ? false : "Set KWD_UPLOAD_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable local database." },
  async () => {
    assert.ok(databaseUrl);
    const target = await assertDisposableLocalDatabase(databaseUrl);
    console.info(`KWD local upload target verified: host=${target.hostname} port=${target.port} addresses=${target.addresses.join(",")}`);
    assert.equal(spawnSync("psql", ["--version"], { encoding: "utf8" }).status, 0, "psql is required.");

    const databaseName = `kwd_upload_${randomUUID().replaceAll("-", "")}`;
    const testDatabaseUrl = databaseUrlFor(databaseUrl, databaseName);
    const creatorId = "10000000-0000-4000-8000-000000000001";
    const attemptId = "20000000-0000-4000-8000-000000000002";
    const invalidAttemptId = "30000000-0000-4000-8000-000000000003";
    const mismatchAttemptId = "40000000-0000-4000-8000-000000000004";
    const token = "50000000-0000-4000-8000-000000000005";
    const driveId = "drive_upload_security_001";
    const snapshot = JSON.stringify({ document_type: "Security Test", document_number: "", document_date: "2026-09-18", subject: "Local upload finalization", persons_involved: "", filing_year: null, filing_subcategory: "", file_name: "local-security.pdf", file_type: "application/pdf", file_size: 4 });

    await success(databaseUrl, `do $bootstrap$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $bootstrap$;`);
    await success(databaseUrl, `create database ${databaseName};`);

    try {
      await success(testDatabaseUrl, `
        create schema auth;
        create function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
        create function public.gen_random_uuid() returns uuid language sql volatile as 'select md5(random()::text || clock_timestamp()::text)::uuid';
      `);
      for (const migration of migrationFiles) {
        const result = await psql(testDatabaseUrl, ["--file", migration]).result;
        assert.equal(result.code, 0, `${migration}\n${result.stderr}`);
      }
      console.info("KWD local upload migrations replayed successfully.");

      await success(testDatabaseUrl, `
        insert into public.users (id, email, name, role, status) values ('${creatorId}', 'upload-security-admin@example.invalid', 'Upload Security Admin', 'ADMIN', 'ACTIVE');
        insert into public.upload_attempts (id, idempotency_key, status, metadata_snapshot, created_by) values
          ('${attemptId}', '60000000-0000-4000-8000-000000000006', 'PENDING_UPLOAD', ${literal(snapshot)}::jsonb, '${creatorId}'),
          ('${invalidAttemptId}', '70000000-0000-4000-8000-000000000007', 'PENDING_UPLOAD', ${literal(snapshot)}::jsonb, '${creatorId}');
        insert into public.upload_attempts (id, idempotency_key, status, drive_file_id, operation_token, metadata_snapshot, created_by)
          values ('${mismatchAttemptId}', '80000000-0000-4000-8000-000000000008', 'PENDING_REGISTRY', 'drive_upload_security_mismatch', '${token}', ${literal(snapshot)}::jsonb, '${creatorId}');
      `);

      assert.equal(lastValue(await success(testDatabaseUrl, `with changed as (update public.upload_attempts set operation_token = '${token}', reservation_expires_at = now() + interval '60 seconds' where id = '${attemptId}' and status = 'PENDING_UPLOAD' and drive_file_id is null and operation_token is null returning id) select count(*) from changed;`)), "1");
      assert.equal(lastValue(await success(testDatabaseUrl, `with changed as (update public.upload_attempts set status = 'UPLOADING', drive_file_id = '${driveId}', reservation_expires_at = null where id = '${attemptId}' and status = 'PENDING_UPLOAD' and operation_token = '${token}' and drive_file_id is null returning id) select count(*) from changed;`)), "1");
      assert.equal(lastValue(await success(testDatabaseUrl, `with changed as (update public.upload_attempts set drive_file_id = 'drive_upload_security_replacement' where id = '${attemptId}' and status = 'PENDING_UPLOAD' and operation_token = '${token}' and drive_file_id is null returning id) select count(*) from changed;`)), "0");
      assert.equal(lastValue(await success(testDatabaseUrl, `with changed as (update public.upload_attempts set status = 'PENDING_REGISTRY' where id = '${attemptId}' and status = 'UPLOADING' and drive_file_id = '${driveId}' and operation_token = '90000000-0000-4000-8000-000000000009' returning id) select count(*) from changed;`)), "0");
      assert.equal(lastValue(await success(testDatabaseUrl, `with changed as (update public.upload_attempts set status = 'PENDING_REGISTRY' where id = '${attemptId}' and status = 'UPLOADING' and drive_file_id = '${driveId}' and operation_token = '${token}' returning id) select count(*) from changed;`)), "1");

      for (const role of ["anon", "authenticated"] as const) {
        await failure(testDatabaseUrl, `set role ${role}; select count(*) from public.finalize_admin_upload('${attemptId}'::uuid, 'Security Test', '', '2026-09-18', 'Local upload finalization', '', '${driveId}', 'https://drive.invalid/${driveId}', 'local-security.pdf', 'application/pdf', null, '', 'upload-security-admin@example.invalid');`, /permission denied/i);
      }
      assert.equal(lastValue(await success(testDatabaseUrl, `select has_function_privilege('service_role', 'public.finalize_admin_upload(uuid,text,text,date,text,text,text,text,text,text,integer,text,text)', 'EXECUTE');`)), "t");
      await failure(testDatabaseUrl, `set role service_role; select count(*) from public.finalize_admin_upload('${invalidAttemptId}'::uuid, 'Security Test', '', '2026-09-18', 'Invalid', '', '${driveId}', 'https://drive.invalid/${driveId}', 'local-security.pdf', 'application/pdf', null, '', 'upload-security-admin@example.invalid');`, /UPLOAD_ATTEMPT_NOT_FINALIZABLE/);
      await failure(testDatabaseUrl, `set role service_role; select count(*) from public.finalize_admin_upload('${mismatchAttemptId}'::uuid, 'Security Test', '', '2026-09-18', 'Mismatch', '', '${driveId}', 'https://drive.invalid/${driveId}', 'local-security.pdf', 'application/pdf', null, '', 'upload-security-admin@example.invalid');`, /UPLOAD_ATTEMPT_NOT_FINALIZABLE/);

      const sessionA = psql(testDatabaseUrl, []);
      sessionA.child.stdin.write(`begin; set role service_role; select count(*) from public.finalize_admin_upload('${attemptId}'::uuid, 'Security Test', '', '2026-09-18', 'Local upload finalization', '', '${driveId}', 'https://drive.invalid/${driveId}', 'local-security.pdf', 'application/pdf', null, '', 'upload-security-admin@example.invalid'); select 'UPLOAD_FINALIZED_LOCK_HELD';\n`);
      await waitForOutput(sessionA.stdout, "UPLOAD_FINALIZED_LOCK_HELD");
      const sessionB = psql(testDatabaseUrl, ["--command", `set role service_role; select count(*) from public.finalize_admin_upload('${attemptId}'::uuid, 'Security Test', '', '2026-09-18', 'Retry', '', '${driveId}', 'https://drive.invalid/${driveId}', 'local-security.pdf', 'application/pdf', null, '', 'upload-security-admin@example.invalid');`]);
      sessionA.child.stdin.write("select pg_catalog.pg_sleep(1.0);\ncommit;\n\\q\n");
      const [resultA, resultB] = await Promise.all([sessionA.result, sessionB.result]);
      assert.equal(resultA.code, 0, resultA.stderr);
      assert.equal(resultB.code, 0, resultB.stderr);
      assert.ok(resultB.elapsedMs >= 700, "second finalization must wait on the locked upload attempt");

      const finalState = await success(testDatabaseUrl, `select status || ':' || drive_file_id || ':' || document_id::text from public.upload_attempts where id = '${attemptId}'; select count(*) from public.documents where drive_file_id = '${driveId}';`);
      const values = finalState.stdout.trim().split(/\r?\n/).filter(Boolean);
      assert.match(values[0] ?? "", new RegExp(`^COMPLETE:${driveId}:`));
      assert.equal(values[1], "1");
      await failure(testDatabaseUrl, `update public.documents set drive_file_id = 'drive_upload_security_changed' where drive_file_id = '${driveId}';`, /DRIVE_FILE_ID_IMMUTABLE/);
      await failure(testDatabaseUrl, `insert into public.documents (document_type, document_date, subject, drive_file_id) values ('Security Test', current_date, 'Duplicate Drive ID', '${driveId}');`, /duplicate key value/i);
      assert.equal(lastValue(await success(testDatabaseUrl, `select has_table_privilege('service_role', 'public.upload_attempts', 'SELECT') || ':' || has_table_privilege('service_role', 'public.upload_attempts', 'INSERT') || ':' || has_table_privilege('service_role', 'public.upload_attempts', 'UPDATE') || ':' || has_table_privilege('service_role', 'public.upload_attempts', 'DELETE');`)), "true:true:true:false");
      console.info("KWD local upload integration verified: repository-style transitions, RPC finalization, locking, and document Drive ID invariants.");
    } finally {
      const terminate = await psql(databaseUrl, ["--command", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}' and pid <> pg_backend_pid();`]).result;
      assert.equal(terminate.code, 0, terminate.stderr);
      const drop = await psql(databaseUrl, ["--command", `drop database if exists ${databaseName};`]).result;
      assert.equal(drop.code, 0, drop.stderr);
    }
  },
);
