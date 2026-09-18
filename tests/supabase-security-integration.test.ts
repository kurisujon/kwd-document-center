import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertDisposableLocalDatabase } from "./helpers/disposable-local-db.ts";

const databaseUrl = process.env.KWD_SECURITY_TEST_DATABASE_URL;
const destructiveOptIn = process.env.KWD_ALLOW_DESTRUCTIVE_LOCAL_DB === "YES";
const integrationEnabled = Boolean(databaseUrl && destructiveOptIn);

const migrationFiles = [
  "20260907000000_create_authorized_users.sql",
  "20260908000000_create_document_registry.sql",
  "20260909000000_add_admin_drive_uploads.sql",
  "20260915000000_grant_service_role_documents_select.sql",
  "20260917000000_phase4_user_management.sql",
  "20260917010000_harden_users_table_privileges.sql",
  "20260917020000_fix_admin_update_user_coalesce.sql",
].map((file) => fileURLToPath(new URL(`../supabase/migrations/${file}`, import.meta.url)));

type PsqlResult = { code: number | null; stdout: string; stderr: string };

function startPsql(url: string, args: string[]) {
  const child = spawn("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--dbname", url, ...args], {
    env: { ...process.env, PGCONNECT_TIMEOUT: "5" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return new Promise<PsqlResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseUrlFor(urlValue: string, databaseName: string) {
  const url = new URL(urlValue);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function lastValue(result: PsqlResult) {
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
}

async function expectSuccess(url: string, sql: string) {
  const result = await startPsql(url, ["--command", sql]);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

async function expectDenied(url: string, sql: string) {
  const result = await startPsql(url, ["--command", sql]);
  assert.notEqual(result.code, 0, "operation must be denied");
  assert.match(result.stderr, /permission denied/i);
}

async function expectRpcError(url: string, sql: string, code: string) {
  const result = await startPsql(url, ["--command", `set role service_role; ${sql}`]);
  assert.notEqual(result.code, 0, `${code} must reject`);
  assert.match(result.stderr, new RegExp(code));
}

async function scalarAs(url: string, role: "authenticated" | "anon" | "service_role", email: string, sql: string) {
  const claims = JSON.stringify({ email });
  const result = await expectSuccess(url, `
    begin;
    set local role ${role};
    set local request.jwt.claims = ${sqlLiteral(claims)};
    ${sql}
    commit;
  `);
  return lastValue(result);
}

test(
  "migrated local Supabase security boundary enforces users RLS, ACLs, and RPC authorization",
  { skip: integrationEnabled ? false : "Set KWD_SECURITY_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable local database." },
  async () => {
    assert.ok(databaseUrl);
    const target = await assertDisposableLocalDatabase(databaseUrl);
    console.info(`KWD local security target verified: host=${target.hostname} port=${target.port} addresses=${target.addresses.join(",")}`);
    const psql = spawnSync("psql", ["--version"], { encoding: "utf8" });
    assert.equal(psql.status, 0, "psql must be installed to run local Supabase security integration tests.");

    const databaseName = `kwd_security_${randomUUID().replaceAll("-", "")}`;
    const testDatabaseUrl = databaseUrlFor(databaseUrl, databaseName);
    const adminId = "10000000-0000-4000-8000-000000000001";
    const staffId = "20000000-0000-4000-8000-000000000002";
    const viewerId = "30000000-0000-4000-8000-000000000003";
    const inactiveId = "40000000-0000-4000-8000-000000000004";
    const adminEmail = "security-admin@example.invalid";
    const staffEmail = "security-staff@example.invalid";
    const viewerEmail = "security-viewer@example.invalid";
    const inactiveEmail = "security-inactive@example.invalid";

    await expectSuccess(databaseUrl, `
      do $bootstrap$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end
      $bootstrap$;
    `);
    await expectSuccess(databaseUrl, `create database ${databaseName};`);

    try {
      await expectSuccess(testDatabaseUrl, `
        create schema auth;
        create function auth.jwt() returns jsonb language sql stable as
          'select coalesce(current_setting(''request.jwt.claims'', true), ''{}'')::jsonb';
        grant usage on schema auth to authenticated;
        grant execute on function auth.jwt() to authenticated;
        create function public.gen_random_uuid() returns uuid language sql volatile as
          'select md5(random()::text || clock_timestamp()::text)::uuid';
      `);

      for (const migration of migrationFiles) {
        const result = await startPsql(testDatabaseUrl, ["--file", migration]);
        assert.equal(result.code, 0, `${migration}\n${result.stderr}`);
      }
      console.info("KWD local security migrations replayed successfully.");

      await expectSuccess(testDatabaseUrl, `
        insert into public.users (id, email, name, role, status) values
          ('${adminId}', '${adminEmail}', 'Security Admin', 'ADMIN', 'ACTIVE'),
          ('${staffId}', '${staffEmail}', 'Security Staff', 'STAFF', 'ACTIVE'),
          ('${viewerId}', '${viewerEmail}', 'Security Viewer', 'VIEWER', 'ACTIVE'),
          ('${inactiveId}', '${inactiveEmail}', 'Security Inactive', 'VIEWER', 'INACTIVE');
        insert into public.documents (document_id, document_type, document_date, subject, status)
          values ('50000000-0000-4000-8000-000000000005', 'Security Test', current_date, 'Local security fixture', 'ACTIVE');
      `);

      const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
      for (const role of ["anon", "authenticated", "service_role"] as const) {
        for (const privilege of privileges) {
          const result = await expectSuccess(testDatabaseUrl, `select has_table_privilege('${role}', 'public.users', '${privilege}');`);
          const expected = role === "authenticated" && privilege === "SELECT";
          assert.equal(lastValue(result), expected ? "t" : "f", `${role} ${privilege}`);
        }
      }

      for (const [email, ownId, otherId] of [
        [adminEmail, adminId, staffId],
        [staffEmail, staffId, adminId],
        [viewerEmail, viewerId, adminId],
      ] as const) {
        assert.equal(await scalarAs(testDatabaseUrl, "authenticated", email, "select count(*) from public.users;"), "1");
        assert.equal(await scalarAs(testDatabaseUrl, "authenticated", email, `select count(*) from public.users where id = '${ownId}';`), "1");
        assert.equal(await scalarAs(testDatabaseUrl, "authenticated", email, `select count(*) from public.users where id = '${otherId}';`), "0");
      }
      // RLS permits an INACTIVE identity to see its own row; getAuthorization()/RPCs separately reject it.
      assert.equal(await scalarAs(testDatabaseUrl, "authenticated", inactiveEmail, "select count(*) from public.users;"), "1");
      assert.equal(await scalarAs(testDatabaseUrl, "authenticated", adminEmail, "select count(*) from public.documents;"), "1");
      assert.equal(await scalarAs(testDatabaseUrl, "authenticated", inactiveEmail, "select count(*) from public.documents;"), "0");

      for (const role of ["anon", "authenticated", "service_role"] as const) {
        const claims = JSON.stringify({ email: adminEmail });
        await expectDenied(testDatabaseUrl, `begin; set local role ${role}; set local request.jwt.claims = ${sqlLiteral(claims)}; insert into public.users (id, email, name, role, status) values ('60000000-0000-4000-8000-000000000006', 'denied-${role}@example.invalid', 'Denied', 'VIEWER', 'ACTIVE');`);
        await expectDenied(testDatabaseUrl, `begin; set local role ${role}; set local request.jwt.claims = ${sqlLiteral(claims)}; update public.users set name = name where id = '${adminId}';`);
        await expectDenied(testDatabaseUrl, `begin; set local role ${role}; set local request.jwt.claims = ${sqlLiteral(claims)}; delete from public.users where id = '${viewerId}';`);
      }

      for (const role of ["anon", "authenticated"] as const) {
        await expectDenied(testDatabaseUrl, `set role ${role}; select count(*) from public.admin_list_users('${adminId}'::uuid);`);
      }
      assert.equal(await scalarAs(testDatabaseUrl, "service_role", adminEmail, `select count(*) from public.admin_list_users('${adminId}'::uuid);`), "4");
      await expectSuccess(testDatabaseUrl, `set role service_role; select count(*) from public.admin_create_user('${adminId}'::uuid, 'security-created@example.invalid', 'Security Created', 'STAFF');`);
      await expectSuccess(testDatabaseUrl, `set role service_role; select count(*) from public.admin_update_user('${adminId}'::uuid, '${staffId}'::uuid, 'VIEWER', null);`);
      await expectRpcError(testDatabaseUrl, `select count(*) from public.admin_list_users('${staffId}'::uuid);`, "ADMIN_REQUIRED");
      await expectRpcError(testDatabaseUrl, `select count(*) from public.admin_list_users('${viewerId}'::uuid);`, "ADMIN_REQUIRED");
      await expectRpcError(testDatabaseUrl, `select count(*) from public.admin_list_users('${inactiveId}'::uuid);`, "ADMIN_REQUIRED");
      await expectRpcError(testDatabaseUrl, `select count(*) from public.admin_update_user('${adminId}'::uuid, '${adminId}'::uuid, 'STAFF', null);`, "SELF_MODIFICATION_FORBIDDEN");
      await expectRpcError(testDatabaseUrl, `select count(*) from public.admin_create_user('${adminId}'::uuid, 'security-created@example.invalid', 'Duplicate', 'VIEWER');`, "USER_ALREADY_EXISTS");

      console.info("KWD local security integration verified: ACLs, self-read RLS, RPC ACLs, and actor authorization.");
    } finally {
      const terminate = await startPsql(databaseUrl, ["--command", `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = '${databaseName}'
          and pid <> pg_backend_pid();
      `]);
      assert.equal(terminate.code, 0, terminate.stderr);
      const drop = await startPsql(databaseUrl, ["--command", `drop database if exists ${databaseName};`]);
      assert.equal(drop.code, 0, drop.stderr);
    }
  },
);
