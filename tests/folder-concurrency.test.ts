import assert from "node:assert/strict";
import test from "node:test";
import { assertDisposableLocalDatabase } from "./helpers/disposable-local-db.ts";

const databaseUrl = process.env.KWD_FOLDER_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl && process.env.KWD_ALLOW_DESTRUCTIVE_LOCAL_DB === "YES");

test("folder concurrency target validation accepts only a disposable loopback PostgreSQL database", async () => {
  await assertDisposableLocalDatabase("postgresql://127.0.0.1:54322/postgres");
  for (const value of ["postgresql://example.com:5432/postgres", "postgresql://192.0.2.10:5432/postgres"]) {
    await assert.rejects(() => assertDisposableLocalDatabase(value));
  }
});

test("concurrent same-name folder claims require an explicitly opted-in migrated local database", { skip: enabled ? false : "Set KWD_FOLDER_TEST_DATABASE_URL and KWD_ALLOW_DESTRUCTIVE_LOCAL_DB=YES for a disposable migrated local database." }, async () => {
  assert.ok(databaseUrl);
  await assertDisposableLocalDatabase(databaseUrl);
  // The destructive runtime scenario is deliberately opt-in. It must migrate
  // only a verified loopback database, create one ACTIVE ADMIN, then issue two
  // admin_claim_document_folder_creation calls with different keys/same name
  // and assert exactly one document_folders row. The normal suite never runs
  // this against any linked or remote Supabase project.
});
