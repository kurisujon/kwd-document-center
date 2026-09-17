import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import test from "node:test";

const databaseUrl = process.env.PHASE4_TEST_DATABASE_URL;
const destructiveOptIn = process.env.PHASE4_ALLOW_DESTRUCTIVE_LOCAL_DB === "YES";
const integrationEnabled = Boolean(databaseUrl && destructiveOptIn);

type PsqlResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
};

type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

function isLoopbackAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
}

async function defaultHostLookup(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function assertDisposableLocalDatabase(urlValue: string, hostLookup: HostLookup = defaultHostLookup) {
  const url = new URL(urlValue);
  assert.ok(
    url.protocol === "postgres:" || url.protocol === "postgresql:",
    "PHASE4_TEST_DATABASE_URL must be a PostgreSQL URL.",
  );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port || "5432";

  if (isIP(hostname) !== 0) {
    assert.ok(isLoopbackAddress(hostname), "The destructive concurrency test only accepts a disposable loopback database.");
    return { hostname, port, addresses: [hostname] };
  }

  assert.equal(hostname.toLowerCase(), "localhost", "The destructive concurrency test only accepts localhost or numeric loopback addresses.");
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await hostLookup(hostname);
  } catch {
    throw new Error("The destructive concurrency test could not resolve localhost to a loopback address.");
  }
  assert.ok(resolved.length > 0, "The destructive concurrency test could not resolve localhost to a loopback address.");
  assert.ok(
    resolved.every(({ address }) => isLoopbackAddress(address)),
    "The destructive concurrency test only accepts localhost when every resolved address is loopback.",
  );
  return { hostname, port, addresses: resolved.map(({ address }) => address) };
}

test("destructive concurrency target validation accepts only verified loopback addresses", async () => {
  await assertDisposableLocalDatabase("postgresql://127.0.0.1:54322/postgres");
  await assertDisposableLocalDatabase("postgresql://127.25.1.9:54322/postgres");
  await assertDisposableLocalDatabase("postgresql://[::1]:54322/postgres");
  await assertDisposableLocalDatabase(
    "postgresql://localhost:54322/postgres",
    async () => [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }],
  );

  for (const url of [
    "postgresql://example.com:54322/postgres",
    "postgresql://192.0.2.10:54322/postgres",
    "postgresql://[2001:db8::10]:54322/postgres",
  ]) {
    await assert.rejects(() => assertDisposableLocalDatabase(url));
  }
  await assert.rejects(
    () => assertDisposableLocalDatabase(
      "postgresql://localhost:54322/postgres",
      async () => [{ address: "127.0.0.1", family: 4 }, { address: "192.0.2.10", family: 4 }],
    ),
  );
});

function startPsql(urlValue: string, sql: string) {
  const startedAt = Date.now();
  const child = spawn(
    "psql",
    ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--dbname", urlValue, "--command", sql],
    { env: { ...process.env, PGCONNECT_TIMEOUT: "5" } },
  );
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

function startInteractivePsql(urlValue: string) {
  const startedAt = Date.now();
  const child = spawn(
    "psql",
    ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--dbname", urlValue],
    { env: { ...process.env, PGCONNECT_TIMEOUT: "5" } },
  );
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

async function runPsql(urlValue: string, sql: string) {
  return startPsql(urlValue, sql).result;
}

async function waitForOutput(readOutput: () => string, expected: string) {
  const deadline = Date.now() + 5_000;
  while (!readOutput().includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for psql marker ${expected}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test(
  "two PostgreSQL sessions cannot concurrently remove both ACTIVE ADMIN users",
  { skip: integrationEnabled ? false : "Set PHASE4_TEST_DATABASE_URL and PHASE4_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable local database." },
  async () => {
    assert.ok(databaseUrl);
    const target = await assertDisposableLocalDatabase(databaseUrl);
    console.info(`Phase 4 destructive local target verified: host=${target.hostname} port=${target.port} addresses=${target.addresses.join(",")}`);
    const psql = spawnSync("psql", ["--version"], { encoding: "utf8" });
    assert.equal(psql.status, 0, "psql must be installed to run the PostgreSQL concurrency test.");

    const adminA = "40000000-0000-4000-8000-000000000001";
    const adminB = "40000000-0000-4000-8000-000000000002";
    const survivor = "40000000-0000-4000-8000-000000000003";

    const setup = await runPsql(databaseUrl, `
      begin;
      truncate table public.users cascade;
      insert into public.users (id, email, name, role, status) values
        ('${adminA}', 'phase4-admin-a@example.invalid', 'Phase 4 Admin A', 'ADMIN', 'ACTIVE'),
        ('${adminB}', 'phase4-admin-b@example.invalid', 'Phase 4 Admin B', 'ADMIN', 'ACTIVE');
      commit;
    `);
    assert.equal(setup.code, 0, setup.stderr);

    try {
      const sessionA = startInteractivePsql(databaseUrl);
      sessionA.child.stdin.write(`
        begin;
        select pg_catalog.pg_advisory_xact_lock(126400, 4);
        select public.admin_update_user(
          '${adminA}'::uuid,
          '${adminB}'::uuid,
          'STAFF',
          null
        );
      `);

      sessionA.child.stdin.write("select 'PHASE4_LOCK_ACQUIRED';\n");
      await waitForOutput(sessionA.stdout, "PHASE4_LOCK_ACQUIRED");

      const sessionB = startPsql(databaseUrl, `
        select public.admin_update_user(
          '${adminB}'::uuid,
          '${adminA}'::uuid,
          null,
          'INACTIVE'
        );
      `);

      sessionA.child.stdin.write("select pg_catalog.pg_sleep(1.5);\ncommit;\n\\q\n");

      const [resultA, resultB] = await Promise.all([sessionA.result, sessionB.result]);
      assert.equal(resultA.code, 0, resultA.stderr);
      assert.notEqual(resultB.code, 0, "the conflicting second mutation must fail");
      assert.match(resultB.stderr, /ADMIN_REQUIRED/);
      assert.ok(resultB.elapsedMs >= 1_000, "the second session must wait for the first transaction's advisory lock");
      console.info(`Phase 4 concurrency observed: Session B blocked for ${resultB.elapsedMs}ms and returned ADMIN_REQUIRED.`);

      const verification = await runPsql(databaseUrl, `
        select pg_catalog.count(*)
        from public.users
        where role = 'ADMIN' and status = 'ACTIVE';
      `);
      assert.equal(verification.code, 0, verification.stderr);
      assert.equal(verification.stdout.trim(), "1");
      console.info("Phase 4 concurrency final state: ACTIVE_ADMIN_COUNT=1.");
    } finally {
      const cleanup = await runPsql(databaseUrl, `
        begin;
        truncate table public.users cascade;
        insert into public.users (id, email, name, role, status)
        values (
          '${survivor}',
          'phase4-integration-admin@example.invalid',
          'Phase 4 Integration Admin',
          'ADMIN',
          'ACTIVE'
        );
        commit;
      `);
      assert.equal(cleanup.code, 0, cleanup.stderr);
    }
  },
);
