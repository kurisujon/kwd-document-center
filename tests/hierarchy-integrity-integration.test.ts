import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assertDisposableLocalDatabase } from "./helpers/disposable-local-db.ts";

const databaseUrl = process.env.KWD_HIERARCHY_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl && process.env.KWD_ALLOW_DESTRUCTIVE_LOCAL_DB === "YES");
const requiredDatabaseName = "kwd_v2_hierarchy_qa";
const protectedDatabaseNames = new Set([
  "postgres",
  "_supabase",
  "storage_vectors",
  "kwd_v2_qa_release",
  "kwd_v2_phase4_qa",
]);

type PsqlResult = { code: number | null; stdout: string; stderr: string; elapsedMs: number };
type HierarchyInput = {
  actorId: string;
  idempotencyKey: string;
  parentFolderId: string | null;
  logicalParentKey: string;
  driveParentId: string;
  departmentKey: string;
  hierarchyKind: "YEAR" | "CATEGORY" | "SUBCATEGORY" | "WORKING_FOLDER" | null;
  filingYear: number;
  category: string | null;
  subcategory: string | null;
  name: string;
  normalizedName: string;
  logicalKey: string;
  operationToken: string;
};
type StaticInput = Omit<HierarchyInput, "idempotencyKey" | "operationToken"> & {
  driveFolderId: string | null;
  uploadEnabled?: boolean;
};

function sqlLiteral(value: string | null) {
  return value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
}

function databaseName(urlValue: string) {
  return decodeURIComponent(new URL(urlValue).pathname.replace(/^\//, "")).toLowerCase();
}

async function assertHierarchyTestDatabase(urlValue: string) {
  const target = await assertDisposableLocalDatabase(urlValue);
  const name = databaseName(urlValue);
  assert.ok(name, "The hierarchy integrity test requires an explicit database name.");
  assert.ok(!protectedDatabaseNames.has(name), `The hierarchy integrity test refuses the protected database ${name}.`);
  assert.equal(name, requiredDatabaseName, `The hierarchy integrity test requires the dedicated ${requiredDatabaseName} database.`);
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

function hierarchyClaimSql(input: HierarchyInput) {
  return `
    select outcome, folder_id, drive_folder_id, operation_token
    from public.admin_claim_hierarchy_folder_creation(
      ${sqlLiteral(input.actorId)}::uuid, ${sqlLiteral(input.idempotencyKey)}::uuid,
      ${sqlLiteral(input.parentFolderId)}::uuid, ${sqlLiteral(input.logicalParentKey)}, ${sqlLiteral(input.driveParentId)},
      ${sqlLiteral(input.departmentKey)}, ${sqlLiteral(input.hierarchyKind)}, ${input.filingYear},
      ${sqlLiteral(input.category)}, ${sqlLiteral(input.subcategory)}, ${sqlLiteral(input.name)},
      ${sqlLiteral(input.normalizedName)}, ${sqlLiteral(input.logicalKey)}, ${sqlLiteral(input.operationToken)}::uuid, 60
    );
  `;
}

function staticRegistrationSql(input: StaticInput) {
  return `
    select folder_id, created
    from public.admin_register_static_document_folder(
      ${sqlLiteral(input.actorId)}::uuid, ${sqlLiteral(input.parentFolderId)}::uuid,
      ${sqlLiteral(input.logicalParentKey)}, ${sqlLiteral(input.driveParentId)}, ${sqlLiteral(input.departmentKey)},
      ${sqlLiteral(input.hierarchyKind)}, ${input.filingYear}, ${sqlLiteral(input.category)},
      ${sqlLiteral(input.subcategory)}, ${sqlLiteral(input.name)}, ${sqlLiteral(input.normalizedName)},
      ${sqlLiteral(input.logicalKey)}, ${sqlLiteral(input.driveFolderId)}, ${input.uploadEnabled ?? false}
    );
  `;
}

function resultLine(result: PsqlResult, outcome: string) {
  return result.stdout.split(/\r?\n/).find((line) => line.startsWith(`${outcome}|`));
}

function returnedFolderId(result: PsqlResult, outcome: string) {
  const line = resultLine(result, outcome);
  assert.ok(line, `Expected ${outcome}, received: ${result.stdout}`);
  const folderId = line.split("|")[1];
  assert.ok(folderId);
  return folderId;
}

function returnedStaticFolderId(result: PsqlResult) {
  const [folderId, created] = result.stdout.trim().split("|");
  assert.ok(folderId);
  assert.ok(created === "t" || created === "f");
  return folderId;
}

test("hierarchy integrity target validation accepts only the dedicated disposable loopback database", async () => {
  await assertHierarchyTestDatabase(`postgresql://127.0.0.1:54322/${requiredDatabaseName}`);
  for (const value of [
    `postgresql://example.com:5432/${requiredDatabaseName}`,
    `postgresql://192.0.2.10:5432/${requiredDatabaseName}`,
    ...[...protectedDatabaseNames].map((name) => `postgresql://127.0.0.1:54322/${name}`),
    "postgresql://127.0.0.1:54322/another_disposable_database",
  ]) {
    await assert.rejects(() => assertHierarchyTestDatabase(value));
  }
});

test(
  "PostgreSQL hierarchy RPCs reject incomplete legacy metadata and preserve valid lifecycle behavior",
  { skip: enabled ? false : "Set KWD_HIERARCHY_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for the dedicated migrated kwd_v2_hierarchy_qa database." },
  async () => {
    assert.ok(databaseUrl);
    const target = await assertHierarchyTestDatabase(databaseUrl);
    console.info(`KWD hierarchy integration target verified: host=${target.hostname} port=${target.port} database=${target.databaseName} addresses=${target.addresses.join(",")}`);
    assert.equal(spawnSync("psql", ["--version"], { encoding: "utf8" }).status, 0, "psql must be installed.");

    const runId = randomUUID();
    const suffix = runId.replaceAll("-", "").slice(0, 12);
    const adminId = randomUUID();
    const staffId = randomUUID();
    const inactiveAdminId = randomUUID();
    const rootDriveId = `hierarchy-root-${suffix}`;
    const baseYear = 2000 + (Number.parseInt(suffix.slice(0, 6), 16) % 99);
    const secondYear = baseYear + 1;
    const folderIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    const logicalKeys = new Set<string>();
    const directFolderIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    directFolderIds.forEach((id) => folderIds.add(id));
    let sessionA: ReturnType<typeof startPsql> | undefined;
    let sessionB: ReturnType<typeof startPsql> | undefined;

    const nextKey = () => {
      const key = randomUUID();
      idempotencyKeys.add(key);
      return key;
    };
    const trackLogicalKey = (key: string) => {
      logicalKeys.add(key);
      return key;
    };
    const claim = (input: Omit<HierarchyInput, "actorId" | "idempotencyKey" | "operationToken"> & Partial<Pick<HierarchyInput, "actorId" | "idempotencyKey" | "operationToken">>) => {
      const value: HierarchyInput = {
        ...input,
        actorId: input.actorId ?? adminId,
        idempotencyKey: input.idempotencyKey ?? nextKey(),
        operationToken: input.operationToken ?? randomUUID(),
      };
      idempotencyKeys.add(value.idempotencyKey);
      logicalKeys.add(value.logicalKey);
      return value;
    };

    try {
      const preflight = await expectSuccess(databaseUrl, `
        select current_database();
        select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname in ('admin_claim_document_folder_creation','admin_claim_hierarchy_folder_creation','admin_register_static_document_folder');
        select position('is distinct from' in lower(pg_get_functiondef('public.admin_claim_hierarchy_folder_creation(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text,text,uuid,integer)'::regprocedure))) > 0;
      `);
      assert.deepEqual(preflight.stdout.trim().split(/\r?\n/), [requiredDatabaseName, "3", "t"], "The dedicated database must contain the ordered hierarchy migrations including the hardening migration.");

      await expectSuccess(databaseUrl, `
        insert into public.users (id,email,name,role,status) values
          (${sqlLiteral(adminId)}::uuid,${sqlLiteral(`hierarchy-admin-${suffix}@example.invalid`)},'Hierarchy Admin','ADMIN','ACTIVE'),
          (${sqlLiteral(staffId)}::uuid,${sqlLiteral(`hierarchy-staff-${suffix}@example.invalid`)},'Hierarchy Staff','STAFF','ACTIVE'),
          (${sqlLiteral(inactiveAdminId)}::uuid,${sqlLiteral(`hierarchy-inactive-${suffix}@example.invalid`)},'Hierarchy Inactive Admin','ADMIN','INACTIVE');

        insert into public.document_folders
          (id,idempotency_key,logical_parent_key,drive_parent_id,name,normalized_name,drive_folder_id,status,created_by,error_category,department_key,hierarchy_kind,filing_year,category,subcategory,logical_key,source)
        values
          (${sqlLiteral(directFolderIds[0]!)}::uuid,${sqlLiteral(nextKey())}::uuid,${sqlLiteral(`legacy-null-parent-${suffix}`)},${sqlLiteral(`legacy-null-drive-parent-${suffix}`)},'Legacy Null','legacy null',${sqlLiteral(`legacy-null-drive-${suffix}`)},'ACTIVE',${sqlLiteral(adminId)}::uuid,null,null,null,null,null,null,null,null),
          (${sqlLiteral(directFolderIds[1]!)}::uuid,${sqlLiteral(nextKey())}::uuid,${sqlLiteral(`legacy-sub-parent-${suffix}`)},${sqlLiteral(`legacy-sub-drive-parent-${suffix}`)},'Legacy Sub','legacy sub',${sqlLiteral(`legacy-sub-drive-${suffix}`)},'ACTIVE',${sqlLiteral(adminId)}::uuid,null,'ADMIN',null,${baseYear},'BAC',null,null,null),
          (${sqlLiteral(directFolderIds[2]!)}::uuid,${sqlLiteral(nextKey())}::uuid,${sqlLiteral(`partial-category-parent-${suffix}`)},${sqlLiteral(`partial-category-drive-parent-${suffix}`)},'Partial Category','partial category',${sqlLiteral(`partial-category-drive-${suffix}`)},'ACTIVE',${sqlLiteral(adminId)}::uuid,null,'ADMIN','CATEGORY',null,null,null,null,null),
          (${sqlLiteral(directFolderIds[3]!)}::uuid,${sqlLiteral(nextKey())}::uuid,${sqlLiteral(`partial-subcategory-parent-${suffix}`)},${sqlLiteral(`partial-subcategory-drive-parent-${suffix}`)},'Partial Subcategory','partial subcategory',${sqlLiteral(`partial-subcategory-drive-${suffix}`)},'ACTIVE',${sqlLiteral(adminId)}::uuid,null,'ADMIN','SUBCATEGORY',${baseYear},'BAC',null,null,null),
          (${sqlLiteral(directFolderIds[4]!)}::uuid,${sqlLiteral(nextKey())}::uuid,'department:ADMIN',${sqlLiteral(rootDriveId)},'Null Drive Candidate','null drive candidate',null,'FAILED',${sqlLiteral(adminId)}::uuid,'DRIVE_UNKNOWN','ADMIN','YEAR',${secondYear},null,null,${sqlLiteral(trackLogicalKey(`ADMIN|${secondYear}|NULL-DRIVE|${suffix}`))},null),
          (${sqlLiteral(directFolderIds[5]!)}::uuid,${sqlLiteral(nextKey())}::uuid,'department:ADMIN',${sqlLiteral(rootDriveId)},'Inactive Static Candidate','inactive static candidate',${sqlLiteral(`inactive-drive-${suffix}`)},'FAILED',${sqlLiteral(adminId)}::uuid,'DRIVE_UNKNOWN','ADMIN','YEAR',${secondYear},null,null,${sqlLiteral(trackLogicalKey(`ADMIN|${secondYear}|INACTIVE|${suffix}`))},'DYNAMIC');
      `);

      await expectRpcError(databaseUrl, hierarchyClaimSql(claim({
        parentFolderId: directFolderIds[0]!, logicalParentKey: `legacy-null-parent-${suffix}`, driveParentId: `legacy-null-drive-${suffix}`,
        departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: baseYear, category: "BAC", subcategory: null,
        name: "BAC", normalizedName: "bac", logicalKey: `ADMIN|${baseYear}|NULL-LEGACY|${suffix}`,
      })), "HIERARCHY_PARENT_MISMATCH");

      await expectRpcError(databaseUrl, hierarchyClaimSql(claim({
        parentFolderId: directFolderIds[1]!, logicalParentKey: `legacy-sub-parent-${suffix}`, driveParentId: `legacy-sub-drive-${suffix}`,
        departmentKey: "ADMIN", hierarchyKind: "SUBCATEGORY", filingYear: baseYear, category: "BAC", subcategory: "AGENDAS",
        name: "AGENDAS", normalizedName: "agendas", logicalKey: `ADMIN|${baseYear}|INVALID-SUB|${suffix}`,
      })), "INVALID_HIERARCHY_RELATIONSHIP");

      await expectRpcError(databaseUrl, hierarchyClaimSql(claim({
        parentFolderId: directFolderIds[2]!, logicalParentKey: `partial-category-parent-${suffix}`, driveParentId: `partial-category-drive-${suffix}`,
        departmentKey: "ADMIN", hierarchyKind: "WORKING_FOLDER", filingYear: baseYear, category: "BAC", subcategory: null,
        name: `Category Working ${suffix}`, normalizedName: `category working ${suffix}`, logicalKey: `ADMIN|${baseYear}|PARTIAL-CATEGORY|${suffix}`,
      })), "HIERARCHY_CONTEXT_MISMATCH");

      await expectRpcError(databaseUrl, hierarchyClaimSql(claim({
        parentFolderId: directFolderIds[3]!, logicalParentKey: `partial-subcategory-parent-${suffix}`, driveParentId: `partial-subcategory-drive-${suffix}`,
        departmentKey: "ADMIN", hierarchyKind: "WORKING_FOLDER", filingYear: baseYear, category: "BAC", subcategory: "AGENDAS",
        name: `Subcategory Working ${suffix}`, normalizedName: `subcategory working ${suffix}`, logicalKey: `ADMIN|${baseYear}|PARTIAL-SUBCATEGORY|${suffix}`,
      })), "HIERARCHY_CONTEXT_MISMATCH");

      const yearA: StaticInput = {
        actorId: adminId, parentFolderId: null, logicalParentKey: "department:ADMIN", driveParentId: rootDriveId,
        departmentKey: "ADMIN", hierarchyKind: "YEAR", filingYear: baseYear, category: null, subcategory: null,
        name: String(baseYear), normalizedName: String(baseYear), logicalKey: trackLogicalKey(`ADMIN|${baseYear}`),
        driveFolderId: `static-year-${baseYear}-${suffix}`,
      };
      const yearAResult = await expectSuccess(databaseUrl, `set role service_role; ${staticRegistrationSql(yearA)}`);
      const yearAId = returnedStaticFolderId(yearAResult);
      folderIds.add(yearAId);
      assert.equal(yearAResult.stdout.trim(), `${yearAId}|t`);

      await expectRpcError(databaseUrl, hierarchyClaimSql(claim({
        parentFolderId: yearAId, logicalParentKey: yearA.logicalKey, driveParentId: yearA.driveFolderId!,
        departmentKey: "ADMIN", hierarchyKind: null, filingYear: baseYear, category: "BAC", subcategory: null,
        name: "Null Kind", normalizedName: "null kind", logicalKey: trackLogicalKey(`${yearA.logicalKey}|NULL-KIND`),
      })), "VALIDATION_ERROR");
      await expectRpcError(databaseUrl, staticRegistrationSql({
        ...yearA, hierarchyKind: null, name: "Null Kind Static", normalizedName: "null kind static",
        logicalKey: trackLogicalKey(`${yearA.logicalKey}|NULL-KIND-STATIC`), driveFolderId: `null-kind-static-${suffix}`,
      }), "VALIDATION_ERROR");

      const yearB: StaticInput = { ...yearA, filingYear: secondYear, name: String(secondYear), normalizedName: String(secondYear), logicalKey: trackLogicalKey(`ADMIN|${secondYear}`), driveFolderId: `static-year-${secondYear}-${suffix}` };
      const yearBResult = await expectSuccess(databaseUrl, `set role service_role; ${staticRegistrationSql(yearB)}`);
      const yearBId = returnedStaticFolderId(yearBResult);
      folderIds.add(yearBId);

      for (const actorId of [staffId, inactiveAdminId]) {
        await expectRpcError(databaseUrl, staticRegistrationSql({
          ...yearB,
          actorId,
          name: `Unauthorized Static ${actorId}`,
          normalizedName: `unauthorized static ${actorId}`,
          logicalKey: `ADMIN|${secondYear}|UNAUTHORIZED|${actorId}`,
          driveFolderId: `unauthorized-static-${actorId}`,
        }), "ADMIN_REQUIRED");
      }

      const staticCategory: StaticInput = {
        actorId: adminId, parentFolderId: yearAId, logicalParentKey: yearA.logicalKey, driveParentId: yearA.driveFolderId!,
        departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: baseYear, category: "MEMORANDUM", subcategory: null,
        name: "MEMORANDUM", normalizedName: "memorandum", logicalKey: trackLogicalKey(`${yearA.logicalKey}|MEMORANDUM`),
        driveFolderId: `static-category-${suffix}`,
      };
      const staticCategoryResult = await expectSuccess(databaseUrl, `set role service_role; ${staticRegistrationSql(staticCategory)}`);
      const staticCategoryId = returnedStaticFolderId(staticCategoryResult);
      folderIds.add(staticCategoryId);
      const validStaticReplay = await expectSuccess(databaseUrl, `set role service_role; ${staticRegistrationSql(staticCategory)}`);
      assert.equal(validStaticReplay.stdout.trim(), `${staticCategoryId}|f`);

      await expectRpcError(databaseUrl, staticRegistrationSql({ ...staticCategory, driveFolderId: null }), "STATIC_ID_MISMATCH");
      await expectRpcError(databaseUrl, staticRegistrationSql({
        ...staticCategory,
        parentFolderId: yearBId,
        logicalParentKey: yearB.logicalKey,
        driveParentId: yearB.driveFolderId!,
        filingYear: secondYear,
      }), "STATIC_ID_MISMATCH");

      const dynamicCategory = claim({
        parentFolderId: yearAId, logicalParentKey: yearA.logicalKey, driveParentId: yearA.driveFolderId!,
        departmentKey: "ADMIN", hierarchyKind: "CATEGORY", filingYear: baseYear, category: "BAC", subcategory: null,
        name: "BAC", normalizedName: "bac", logicalKey: trackLogicalKey(`${yearA.logicalKey}|BAC`),
      });
      const dynamicClaim = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql(dynamicCategory)}`);
      const dynamicCategoryId = returnedFolderId(dynamicClaim, "CLAIMED");
      folderIds.add(dynamicCategoryId);
      const sameKeyInProgress = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql({ ...dynamicCategory, operationToken: randomUUID() })}`);
      assert.ok(resultLine(sameKeyInProgress, "IN_PROGRESS")?.startsWith(`IN_PROGRESS|${dynamicCategoryId}|`));
      const dynamicCategoryDriveId = `dynamic-category-${suffix}`;
      const activatedCategory = await expectSuccess(databaseUrl, `
        set role service_role;
        select public.admin_set_document_folder_drive_id(${sqlLiteral(dynamicCategoryId)}::uuid,${sqlLiteral(adminId)}::uuid,${sqlLiteral(dynamicCategory.operationToken)}::uuid,${sqlLiteral(dynamicCategoryDriveId)});
        select public.admin_finalize_document_folder_creation(${sqlLiteral(dynamicCategoryId)}::uuid,${sqlLiteral(adminId)}::uuid,${sqlLiteral(dynamicCategory.operationToken)}::uuid);
      `);
      assert.deepEqual(activatedCategory.stdout.trim().split(/\r?\n/), ["t", "t"]);
      const sameKeyActive = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql({ ...dynamicCategory, operationToken: randomUUID() })}`);
      assert.equal(resultLine(sameKeyActive, "ACTIVE"), `ACTIVE|${dynamicCategoryId}|${dynamicCategoryDriveId}|`);
      const differentKeyDuplicate = claim({ ...dynamicCategory, idempotencyKey: nextKey(), operationToken: randomUUID() });
      const duplicateResult = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql(differentKeyDuplicate)}`);
      assert.equal(resultLine(duplicateResult, "DUPLICATE_NAME"), "DUPLICATE_NAME|||");

      await expectRpcError(databaseUrl, staticRegistrationSql({ ...dynamicCategory, driveFolderId: dynamicCategoryDriveId }), "STATIC_ID_MISMATCH");
      await expectRpcError(databaseUrl, staticRegistrationSql({
        actorId: adminId, parentFolderId: null, logicalParentKey: "department:ADMIN", driveParentId: rootDriveId,
        departmentKey: "ADMIN", hierarchyKind: "YEAR", filingYear: secondYear, category: null, subcategory: null,
        name: "Null Drive Candidate", normalizedName: "null drive candidate",
        logicalKey: `ADMIN|${secondYear}|NULL-DRIVE|${suffix}`, driveFolderId: `recovered-null-drive-${suffix}`,
      }), "STATIC_ID_MISMATCH");
      await expectRpcError(databaseUrl, staticRegistrationSql({
        actorId: adminId, parentFolderId: null, logicalParentKey: "department:ADMIN", driveParentId: rootDriveId,
        departmentKey: "ADMIN", hierarchyKind: "YEAR", filingYear: secondYear, category: null, subcategory: null,
        name: "Inactive Static Candidate", normalizedName: "inactive static candidate",
        logicalKey: `ADMIN|${secondYear}|INACTIVE|${suffix}`, driveFolderId: `inactive-static-${suffix}`,
      }), "STATIC_ID_MISMATCH");

      const subcategory = claim({
        parentFolderId: dynamicCategoryId, logicalParentKey: dynamicCategory.logicalKey, driveParentId: dynamicCategoryDriveId,
        departmentKey: "ADMIN", hierarchyKind: "SUBCATEGORY", filingYear: baseYear, category: "BAC", subcategory: "AGENDAS",
        name: "AGENDAS", normalizedName: "agendas", logicalKey: trackLogicalKey(`${dynamicCategory.logicalKey}|AGENDAS`),
      });
      const subcategoryClaim = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql(subcategory)}`);
      const subcategoryId = returnedFolderId(subcategoryClaim, "CLAIMED");
      folderIds.add(subcategoryId);
      const subcategoryDriveId = `dynamic-subcategory-${suffix}`;
      await expectSuccess(databaseUrl, `
        set role service_role;
        select public.admin_set_document_folder_drive_id(${sqlLiteral(subcategoryId)}::uuid,${sqlLiteral(adminId)}::uuid,${sqlLiteral(subcategory.operationToken)}::uuid,${sqlLiteral(subcategoryDriveId)});
        select public.admin_finalize_document_folder_creation(${sqlLiteral(subcategoryId)}::uuid,${sqlLiteral(adminId)}::uuid,${sqlLiteral(subcategory.operationToken)}::uuid);
      `);

      const categoryWorking = claim({
        parentFolderId: dynamicCategoryId, logicalParentKey: dynamicCategory.logicalKey, driveParentId: dynamicCategoryDriveId,
        departmentKey: "ADMIN", hierarchyKind: "WORKING_FOLDER", filingYear: baseYear, category: "BAC", subcategory: null,
        name: `Category Working ${suffix}`, normalizedName: `category working ${suffix}`, logicalKey: trackLogicalKey(`${dynamicCategory.logicalKey}|category working ${suffix}`),
      });
      const categoryWorkingResult = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql(categoryWorking)}`);
      folderIds.add(returnedFolderId(categoryWorkingResult, "CLAIMED"));
      const subcategoryWorking = claim({
        parentFolderId: subcategoryId, logicalParentKey: subcategory.logicalKey, driveParentId: subcategoryDriveId,
        departmentKey: "ADMIN", hierarchyKind: "WORKING_FOLDER", filingYear: baseYear, category: "BAC", subcategory: "AGENDAS",
        name: `Subcategory Working ${suffix}`, normalizedName: `subcategory working ${suffix}`, logicalKey: trackLogicalKey(`${subcategory.logicalKey}|subcategory working ${suffix}`),
      });
      const subcategoryWorkingResult = await expectSuccess(databaseUrl, `set role service_role; ${hierarchyClaimSql(subcategoryWorking)}`);
      folderIds.add(returnedFolderId(subcategoryWorkingResult, "CLAIMED"));

      for (const actorId of [staffId, inactiveAdminId]) {
        await expectRpcError(databaseUrl, hierarchyClaimSql(claim({
          actorId, parentFolderId: dynamicCategoryId, logicalParentKey: dynamicCategory.logicalKey, driveParentId: dynamicCategoryDriveId,
          departmentKey: "ADMIN", hierarchyKind: "WORKING_FOLDER", filingYear: baseYear, category: "BAC", subcategory: null,
          name: `Unauthorized ${actorId}`, normalizedName: `unauthorized ${actorId}`, logicalKey: `${dynamicCategory.logicalKey}|unauthorized|${actorId}`,
        })), "ADMIN_REQUIRED");
      }

      const concurrentName = `Concurrent ${suffix}`;
      const concurrentBase = claim({
        parentFolderId: dynamicCategoryId, logicalParentKey: dynamicCategory.logicalKey, driveParentId: dynamicCategoryDriveId,
        departmentKey: "ADMIN", hierarchyKind: "WORKING_FOLDER", filingYear: baseYear, category: "BAC", subcategory: null,
        name: concurrentName, normalizedName: concurrentName.toLowerCase(), logicalKey: trackLogicalKey(`${dynamicCategory.logicalKey}|${concurrentName.toLowerCase()}`),
      });
      const concurrentOther = { ...concurrentBase, idempotencyKey: nextKey(), operationToken: randomUUID() };
      sessionA = startPsql(databaseUrl);
      sessionA.child.stdin.write(`set role service_role; begin; ${hierarchyClaimSql(concurrentBase)} select 'HIERARCHY_FIRST_CLAIM_HELD';\n`);
      await waitForOutput(sessionA.stdout, "HIERARCHY_FIRST_CLAIM_HELD");
      sessionB = startPsql(databaseUrl);
      sessionB.child.stdin.write(`set role service_role; select 'HIERARCHY_SECOND_CLAIM_STARTED'; ${hierarchyClaimSql(concurrentOther)} \\q\n`);
      await waitForOutput(sessionB.stdout, "HIERARCHY_SECOND_CLAIM_STARTED");
      sessionA.child.stdin.write("select pg_catalog.pg_sleep(1.0);\ncommit;\n\\q\n");
      const [concurrentA, concurrentB] = await Promise.all([sessionA.result, sessionB.result]);
      assert.equal(concurrentA.code, 0, concurrentA.stderr);
      assert.equal(concurrentB.code, 0, concurrentB.stderr);
      assert.ok(concurrentB.elapsedMs >= 700, "The competing hierarchy claim must wait on canonical uniqueness.");
      const concurrentFolderId = returnedFolderId(concurrentA, "CLAIMED");
      folderIds.add(concurrentFolderId);
      assert.equal(resultLine(concurrentB, "DUPLICATE_NAME"), "DUPLICATE_NAME|||");
      const canonicalCount = await expectSuccess(databaseUrl, `select count(*) from public.document_folders where logical_parent_key=${sqlLiteral(dynamicCategory.logicalKey)} and normalized_name=${sqlLiteral(concurrentName.toLowerCase())};`);
      assert.equal(canonicalCount.stdout.trim(), "1");

      const legacyKey = nextKey();
      const legacyToken = randomUUID();
      const legacyLogicalParent = `legacy-operation-${suffix}`;
      const legacyDriveParent = `legacy-operation-parent-${suffix}`;
      const legacyName = `Legacy Operation ${suffix}`;
      const legacyClaimSql = `select outcome,folder_id,drive_folder_id,operation_token from public.admin_claim_document_folder_creation(${sqlLiteral(adminId)}::uuid,${sqlLiteral(legacyKey)}::uuid,${sqlLiteral(legacyLogicalParent)},${sqlLiteral(legacyDriveParent)},${sqlLiteral(legacyName)},${sqlLiteral(legacyName.toLowerCase())},${sqlLiteral(legacyToken)}::uuid,60);`;
      const legacyClaim = await expectSuccess(databaseUrl, `set role service_role; ${legacyClaimSql}`);
      const legacyFolderId = returnedFolderId(legacyClaim, "CLAIMED");
      folderIds.add(legacyFolderId);
      const legacyDriveId = `legacy-operation-drive-${suffix}`;
      await expectSuccess(databaseUrl, `
        set role service_role;
        select public.admin_set_document_folder_drive_id(${sqlLiteral(legacyFolderId)}::uuid,${sqlLiteral(adminId)}::uuid,${sqlLiteral(legacyToken)}::uuid,${sqlLiteral(legacyDriveId)});
        select public.admin_finalize_document_folder_creation(${sqlLiteral(legacyFolderId)}::uuid,${sqlLiteral(adminId)}::uuid,${sqlLiteral(legacyToken)}::uuid);
      `);
      const legacyReplay = await expectSuccess(databaseUrl, `set role service_role; ${legacyClaimSql}`);
      assert.equal(resultLine(legacyReplay, "ACTIVE"), `ACTIVE|${legacyFolderId}|${legacyDriveId}|`);

      console.info("KWD hierarchy integration verified: NULL-safe parent validation, strict static replay, valid hierarchy paths, actor authorization, replay semantics, canonical concurrency, and legacy Phase 7C lifecycle.");
    } finally {
      const sessions = [sessionA, sessionB].filter((session) => session !== undefined);
      for (const session of sessions) if (session && session.child.exitCode === null) session.child.kill();
      await Promise.allSettled(sessions.map((session) => session.result));
      const folderIdValues = [...folderIds].map((id) => `${sqlLiteral(id)}::uuid`).join(",");
      const keyValues = [...idempotencyKeys].map((id) => `${sqlLiteral(id)}::uuid`).join(",");
      const logicalKeyValues = [...logicalKeys].map((key) => sqlLiteral(key)).join(",");
      const cleanup = await expectSuccess(databaseUrl, `
        delete from public.document_folders
        where id=any(array[${folderIdValues}]::uuid[])
           or idempotency_key=any(array[${keyValues}]::uuid[])
           or logical_key=any(array[${logicalKeyValues}]::text[]);
        delete from public.users where id=any(array[${sqlLiteral(adminId)}::uuid,${sqlLiteral(staffId)}::uuid,${sqlLiteral(inactiveAdminId)}::uuid]);
        select
          (select count(*) from public.document_folders where id=any(array[${folderIdValues}]::uuid[]) or idempotency_key=any(array[${keyValues}]::uuid[]) or logical_key=any(array[${logicalKeyValues}]::text[])),
          (select count(*) from public.users where id=any(array[${sqlLiteral(adminId)}::uuid,${sqlLiteral(staffId)}::uuid,${sqlLiteral(inactiveAdminId)}::uuid]));
      `);
      assert.equal(cleanup.stdout.trim(), "0|0");
      console.info("KWD hierarchy integration cleanup verified: folderRows=0 userRows=0.");
    }
  },
);
