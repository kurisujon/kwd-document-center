import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assertDisposableLocalDatabase } from "./helpers/disposable-local-db.ts";

const databaseUrl = process.env.KWD_FOLDER_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl && process.env.KWD_ALLOW_DESTRUCTIVE_LOCAL_DB === "YES");
const requiredDatabaseName = "kwd_v2_folder_qa";
const protectedDatabaseNames = new Set([
  "postgres",
  "_supabase",
  "storage_vectors",
  "kwd_v2_qa_release",
  "kwd_v2_phase4_qa",
]);

type PsqlResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
};

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseName(urlValue: string) {
  return decodeURIComponent(new URL(urlValue).pathname.replace(/^\//, "")).toLowerCase();
}

async function assertFolderTestDatabase(urlValue: string) {
  const target = await assertDisposableLocalDatabase(urlValue);
  const name = databaseName(urlValue);
  assert.ok(name, "The destructive folder test requires an explicit database name.");
  assert.ok(!protectedDatabaseNames.has(name), `The destructive folder test refuses the protected database ${name}.`);
  assert.equal(
    name,
    requiredDatabaseName,
    `The destructive folder test requires the dedicated ${requiredDatabaseName} database.`,
  );
  return { ...target, databaseName: name };
}

function startPsql(urlValue: string, sql?: string) {
  const startedAt = Date.now();
  const args = [
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--quiet",
    "--field-separator=|",
    "--dbname",
    urlValue,
  ];
  if (sql !== undefined) args.push("--command", sql);
  const child = spawn("psql", args, { env: { ...process.env, PGCONNECT_TIMEOUT: "5" } });
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

async function expectSuccess(urlValue: string, sql: string) {
  const result = await runPsql(urlValue, sql);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

async function expectRpcError(urlValue: string, sql: string, code: string) {
  const result = await runPsql(urlValue, `set role service_role; ${sql}`);
  assert.notEqual(result.code, 0, `${code} must reject the request.`);
  assert.match(result.stderr, new RegExp(code));
}

async function waitForOutput(readOutput: () => string, expected: string) {
  const deadline = Date.now() + 5_000;
  while (!readOutput().includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for psql marker ${expected}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function claimSql(input: {
  actorId: string;
  idempotencyKey: string;
  logicalParentKey: string;
  driveParentId: string;
  name: string;
  normalizedName: string;
  operationToken: string;
}) {
  return `
    select outcome, folder_id, drive_folder_id, operation_token
    from public.admin_claim_document_folder_creation(
      ${sqlLiteral(input.actorId)}::uuid,
      ${sqlLiteral(input.idempotencyKey)}::uuid,
      ${sqlLiteral(input.logicalParentKey)},
      ${sqlLiteral(input.driveParentId)},
      ${sqlLiteral(input.name)},
      ${sqlLiteral(input.normalizedName)},
      ${sqlLiteral(input.operationToken)}::uuid,
      60
    );
  `;
}

function resultLine(result: PsqlResult, outcome: string) {
  return result.stdout.split(/\r?\n/).find((line) => line.startsWith(`${outcome}|`));
}

test("folder concurrency target validation accepts only the dedicated disposable loopback database", async () => {
  await assertFolderTestDatabase(`postgresql://127.0.0.1:54322/${requiredDatabaseName}`);
  for (const value of [
    `postgresql://example.com:5432/${requiredDatabaseName}`,
    `postgresql://192.0.2.10:5432/${requiredDatabaseName}`,
    ...[...protectedDatabaseNames].map((name) => `postgresql://127.0.0.1:54322/${name}`),
    "postgresql://127.0.0.1:54322/another_disposable_database",
  ]) {
    await assert.rejects(() => assertFolderTestDatabase(value));
  }
});

test(
  "concurrent same-name folder claims preserve the legacy RPC lifecycle and hierarchy protections",
  { skip: enabled ? false : "Set KWD_FOLDER_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for the dedicated migrated kwd_v2_folder_qa database." },
  async () => {
    assert.ok(databaseUrl);
    const target = await assertFolderTestDatabase(databaseUrl);
    console.info(`KWD folder integration target verified: host=${target.hostname} port=${target.port} database=${target.databaseName} addresses=${target.addresses.join(",")}`);
    assert.equal(spawnSync("psql", ["--version"], { encoding: "utf8" }).status, 0, "psql must be installed.");

    const runId = randomUUID();
    const adminId = randomUUID();
    const otherAdminId = randomUUID();
    const staffId = randomUUID();
    const inactiveAdminId = randomUUID();
    const keyA = randomUUID();
    const keyB = randomUUID();
    const keyC = randomUUID();
    const hierarchyKeyA = randomUUID();
    const hierarchyKeyB = randomUUID();
    const tokenA = randomUUID();
    const tokenB = randomUUID();
    const logicalParentKey = `integration:folder:${runId}`;
    const driveParentId = `integration-parent-${runId}`;
    const folderName = `Concurrency ${runId}`;
    const normalizedName = folderName.toLowerCase();
    const driveFolderId = `integration-folder-${runId}`;
    const fixtureUserIds = [adminId, otherAdminId, staffId, inactiveAdminId];
    const fixtureKeys = [keyA, keyB, keyC, hierarchyKeyA, hierarchyKeyB];
    let sessionA: ReturnType<typeof startPsql> | undefined;
    let sessionB: ReturnType<typeof startPsql> | undefined;

    const baseClaim = {
      actorId: adminId,
      idempotencyKey: keyA,
      logicalParentKey,
      driveParentId,
      name: folderName,
      normalizedName,
      operationToken: tokenA,
    };

    try {
      const preflight = await expectSuccess(databaseUrl, `
        select current_database();
        select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'admin_claim_document_folder_creation',
            'admin_set_document_folder_drive_id',
            'admin_finalize_document_folder_creation',
            'admin_claim_hierarchy_folder_creation'
          );
      `);
      assert.deepEqual(preflight.stdout.trim().split(/\r?\n/), [requiredDatabaseName, "4"], "The dedicated database must contain all folder migrations.");

      await expectSuccess(databaseUrl, `
        insert into public.users (id, email, name, role, status) values
          (${sqlLiteral(adminId)}::uuid, ${sqlLiteral(`folder-admin-${runId}@example.invalid`)}, 'Folder Admin', 'ADMIN', 'ACTIVE'),
          (${sqlLiteral(otherAdminId)}::uuid, ${sqlLiteral(`folder-admin-other-${runId}@example.invalid`)}, 'Folder Other Admin', 'ADMIN', 'ACTIVE'),
          (${sqlLiteral(staffId)}::uuid, ${sqlLiteral(`folder-staff-${runId}@example.invalid`)}, 'Folder Staff', 'STAFF', 'ACTIVE'),
          (${sqlLiteral(inactiveAdminId)}::uuid, ${sqlLiteral(`folder-inactive-${runId}@example.invalid`)}, 'Folder Inactive Admin', 'ADMIN', 'INACTIVE');
      `);

      sessionA = startPsql(databaseUrl);
      sessionA.child.stdin.write(`
        set role service_role;
        begin;
        ${claimSql(baseClaim)}
        select 'FIRST_CLAIM_HELD';
      `);
      await waitForOutput(sessionA.stdout, "FIRST_CLAIM_HELD");

      sessionB = startPsql(databaseUrl);
      sessionB.child.stdin.write(`
        set role service_role;
        select 'SECOND_CLAIM_STARTED';
        ${claimSql({ ...baseClaim, idempotencyKey: keyB, operationToken: tokenB })}
        \\q
      `);
      await waitForOutput(sessionB.stdout, "SECOND_CLAIM_STARTED");
      sessionA.child.stdin.write("select pg_catalog.pg_sleep(1.0);\ncommit;\n\\q\n");

      const [resultA, resultB] = await Promise.all([sessionA.result, sessionB.result]);
      assert.equal(resultA.code, 0, resultA.stderr);
      assert.equal(resultB.code, 0, resultB.stderr);
      assert.ok(resultB.elapsedMs >= 700, "The competing PostgreSQL session must wait on the winner's uncommitted unique-key claim.");
      const claimA = resultLine(resultA, "CLAIMED");
      const claimB = resultLine(resultB, "DUPLICATE_NAME");
      assert.ok(claimA, `Expected CLAIMED from the first session, received: ${resultA.stdout}`);
      assert.ok(claimB, `Expected DUPLICATE_NAME from the second session, received: ${resultB.stdout}`);
      const [, folderId, , returnedToken] = claimA.split("|");
      assert.ok(folderId);
      assert.equal(returnedToken, tokenA);
      console.info(`KWD folder concurrency observed: outcomes=CLAIMED,DUPLICATE_NAME blockedMs=${resultB.elapsedMs}.`);

      const leasedReplay = await expectSuccess(databaseUrl, `set role service_role; ${claimSql({ ...baseClaim, operationToken: randomUUID() })}`);
      assert.ok(resultLine(leasedReplay, "IN_PROGRESS")?.startsWith(`IN_PROGRESS|${folderId}|`));

      const differentKeyReplay = await expectSuccess(databaseUrl, `set role service_role; ${claimSql({ ...baseClaim, idempotencyKey: keyC, operationToken: randomUUID() })}`);
      assert.equal(resultLine(differentKeyReplay, "DUPLICATE_NAME"), "DUPLICATE_NAME|||");

      for (const mismatchedClaim of [
        { ...baseClaim, logicalParentKey: `${logicalParentKey}:other`, operationToken: randomUUID() },
        { ...baseClaim, driveParentId: `${driveParentId}-other`, operationToken: randomUUID() },
        { ...baseClaim, name: `${folderName} other`, operationToken: randomUUID() },
        { ...baseClaim, normalizedName: `${normalizedName} other`, operationToken: randomUUID() },
        { ...baseClaim, actorId: otherAdminId, operationToken: randomUUID() },
      ]) {
        await expectRpcError(databaseUrl, claimSql(mismatchedClaim), "IDEMPOTENCY_MISMATCH");
      }

      for (const actorId of [staffId, inactiveAdminId]) {
        await expectRpcError(databaseUrl, claimSql({ ...baseClaim, actorId, idempotencyKey: randomUUID(), operationToken: randomUUID() }), "ADMIN_REQUIRED");
      }

      const finalized = await expectSuccess(databaseUrl, `
        set role service_role;
        select public.admin_set_document_folder_drive_id(
          ${sqlLiteral(folderId)}::uuid,
          ${sqlLiteral(adminId)}::uuid,
          ${sqlLiteral(tokenA)}::uuid,
          ${sqlLiteral(driveFolderId)}
        );
        select public.admin_finalize_document_folder_creation(
          ${sqlLiteral(folderId)}::uuid,
          ${sqlLiteral(adminId)}::uuid,
          ${sqlLiteral(tokenA)}::uuid
        );
      `);
      assert.deepEqual(finalized.stdout.trim().split(/\r?\n/), ["t", "t"]);

      const activeReplay = await expectSuccess(databaseUrl, `set role service_role; ${claimSql({ ...baseClaim, operationToken: randomUUID() })}`);
      assert.equal(resultLine(activeReplay, "ACTIVE"), `ACTIVE|${folderId}|${driveFolderId}|`);

      const activeDifferentKeyReplay = await expectSuccess(databaseUrl, `set role service_role; ${claimSql({ ...baseClaim, idempotencyKey: keyC, operationToken: randomUUID() })}`);
      assert.equal(resultLine(activeDifferentKeyReplay, "DUPLICATE_NAME"), "DUPLICATE_NAME|||");

      const canonical = await expectSuccess(databaseUrl, `
        select pg_catalog.count(*)
        from public.document_folders
        where logical_parent_key = ${sqlLiteral(logicalParentKey)}
          and normalized_name = ${sqlLiteral(normalizedName)};
      `);
      assert.equal(canonical.stdout.trim(), "1");

      await expectRpcError(databaseUrl, `
        select * from public.admin_claim_hierarchy_folder_creation(
          ${sqlLiteral(adminId)}::uuid, ${sqlLiteral(hierarchyKeyA)}::uuid,
          ${sqlLiteral(folderId)}::uuid, ${sqlLiteral(logicalParentKey)}, ${sqlLiteral(driveFolderId)},
          'ADMIN', 'YEAR', 2099, null, null, '2099', '2099',
          ${sqlLiteral(`ADMIN|2099|${runId}`)}, ${sqlLiteral(randomUUID())}::uuid, 60
        );
      `, "INVALID_HIERARCHY_PARENT");
      await expectRpcError(databaseUrl, `
        select * from public.admin_claim_hierarchy_folder_creation(
          ${sqlLiteral(adminId)}::uuid, ${sqlLiteral(hierarchyKeyB)}::uuid,
          ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(`ADMIN|2099|${runId}`)}, ${sqlLiteral(driveFolderId)},
          'ADMIN', 'CATEGORY', 2099, 'TEST', null, 'TEST', 'test',
          ${sqlLiteral(`ADMIN|2099|TEST|${runId}`)}, ${sqlLiteral(randomUUID())}::uuid, 60
        );
      `, "INVALID_HIERARCHY_PARENT");
      console.info("KWD folder integration verified: replay lifecycle, complete legacy identity, actor authorization, canonical uniqueness, and hierarchy parent rejection.");
    } finally {
      const sessions = [sessionA, sessionB].filter((session) => session !== undefined);
      for (const session of sessions) {
        if (session && session.child.exitCode === null) session.child.kill();
      }
      await Promise.allSettled(sessions.map((session) => session.result));
      const cleanup = await expectSuccess(databaseUrl, `
        delete from public.document_folders
        where idempotency_key = any(array[${fixtureKeys.map((key) => `${sqlLiteral(key)}::uuid`).join(", ")}]);
        delete from public.users
        where id = any(array[${fixtureUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(", ")}]);
        select
          (select pg_catalog.count(*) from public.document_folders where idempotency_key = any(array[${fixtureKeys.map((key) => `${sqlLiteral(key)}::uuid`).join(", ")}])) ,
          (select pg_catalog.count(*) from public.users where id = any(array[${fixtureUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(", ")}])) ;
      `);
      assert.equal(cleanup.stdout.trim(), "0|0");
      console.info("KWD folder integration cleanup verified: folderRows=0 userRows=0.");
    }
  },
);
