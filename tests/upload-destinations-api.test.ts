import assert from "node:assert/strict";
import test from "node:test";
import { createUploadDestinationListHandler } from "../src/lib/documents/upload-destination.ts";

const staff = { kind: "authorized" as const, user: { id: "staff", email: "staff@example.test", name: "Staff", role: "STAFF" as const, status: "ACTIVE" as const } };
const destination = { destinationId: "11111111-1111-4111-8111-111111111111", kind: "CATEGORY" as const, filingYear: 2027, category: "BACTI TEST", subcategory: null, label: "2027 / BACTI TEST" };

test("upload destination API uses existing upload authorization and safe empty responses", async () => {
  const empty = createUploadDestinationListHandler({ getAuthorization: async () => staff, listDestinations: async () => [] });
  const response = await empty();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { destinations: [] });
  assert.equal((await createUploadDestinationListHandler({ getAuthorization: async () => ({ kind: "unauthenticated" as const }), listDestinations: async () => [] })()).status, 401);
  assert.equal((await createUploadDestinationListHandler({ getAuthorization: async () => ({ kind: "authorized" as const, user: { ...staff.user, role: "VIEWER" as const } }), listDestinations: async () => [] })()).status, 403);
});

test("upload destination API serializes only safe hierarchy metadata and hides failures", async () => {
  const response = await createUploadDestinationListHandler({ getAuthorization: async () => staff, listDestinations: async () => [destination] })();
  const body = await response.json();
  assert.deepEqual(body, { destinations: [destination] });
  const serialized = JSON.stringify(body);
  for (const key of ["driveFolderId", "driveParentId", "operationToken", "lease", "provider"]) assert.equal(serialized.includes(key), false);
  const failed = await createUploadDestinationListHandler({ getAuthorization: async () => staff, listDestinations: async () => { throw new Error("internal-db-details"); } })();
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(await failed.json()).includes("internal-db-details"), false);
});
