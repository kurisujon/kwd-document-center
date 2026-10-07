import assert from "node:assert/strict";
import test from "node:test";
import { createUploadDestinationSettingsListHandler, createUploadDestinationSettingsPatchHandler } from "../src/lib/documents/upload-destination-settings-api.ts";

const admin = { kind: "authorized" as const, user: { id: "admin", email: "admin@example.test", name: "Admin", role: "ADMIN" as const, status: "ACTIVE" as const } };
const staff = { kind: "authorized" as const, user: { ...admin.user, role: "STAFF" as const } };
const setting = { destinationId: "11111111-1111-4111-8111-111111111111", hierarchyKind: "CATEGORY" as const, filingYear: 2027, category: "BACTI TEST", subcategory: null, displayName: "2027 / BACTI TEST", uploadEnabled: false };

function dependencies(authorization = admin) {
  return { getAuthorization: async () => authorization, listSettings: async () => [setting], setEnabled: async (destinationId: string, uploadEnabled: boolean) => ({ ...setting, destinationId, uploadEnabled }) };
}

function request(body: unknown, options: { origin?: string; contentType?: string } = {}) {
  return new Request("https://kwd.example.test/api/admin/folders/upload-settings", { method: "PATCH", headers: { origin: options.origin ?? "https://kwd.example.test", "content-type": options.contentType ?? "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("admin settings API requires ACTIVE ADMIN and returns safe eligible settings", async () => {
  const get = createUploadDestinationSettingsListHandler(dependencies());
  const response = await get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { destinations: [setting] });
  for (const field of ["driveFolderId", "driveParentId", "operationToken", "lease"]) assert.equal(JSON.stringify(body).includes(field), false);
  assert.equal((await createUploadDestinationSettingsListHandler(dependencies({ kind: "unauthenticated" as const }))()).status, 401);
  assert.equal((await createUploadDestinationSettingsListHandler(dependencies(staff))()).status, 403);
  assert.equal((await createUploadDestinationSettingsListHandler(dependencies({ kind: "inactive" as const }))()).status, 403);
  const empty = await createUploadDestinationSettingsListHandler({ ...dependencies(), listSettings: async () => [] })();
  assert.deepEqual(await empty.json(), { destinations: [] });
});

test("admin settings PATCH is JSON, same-origin, strict, and accepts only logical controls", async () => {
  let captured: { destinationId: string; uploadEnabled: boolean } | null = null;
  const handler = createUploadDestinationSettingsPatchHandler({ ...dependencies(), setEnabled: async (destinationId, uploadEnabled) => { captured = { destinationId, uploadEnabled }; return { ...setting, destinationId, uploadEnabled }; } });
  const response = await handler(request({ destinationId: setting.destinationId, uploadEnabled: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(captured, { destinationId: setting.destinationId, uploadEnabled: true });
  assert.deepEqual(await response.json(), { destination: { ...setting, uploadEnabled: true } });
  assert.equal((await createUploadDestinationSettingsPatchHandler(dependencies({ kind: "unauthenticated" as const }))(request({ destinationId: setting.destinationId, uploadEnabled: true }))).status, 401);
  assert.equal((await createUploadDestinationSettingsPatchHandler(dependencies(staff))(request({ destinationId: setting.destinationId, uploadEnabled: true }))).status, 403);
  assert.equal((await handler(request({ destinationId: setting.destinationId, uploadEnabled: true }, { origin: "https://other.example.test" }))).status, 403);
  assert.equal((await handler(request({ destinationId: setting.destinationId, uploadEnabled: true }, { contentType: "text/plain" }))).status, 415);
  for (const forbidden of ["hierarchyKind", "departmentKey", "driveFolderId", "logicalKey"]) {
    const invalid = await handler(request({ destinationId: setting.destinationId, uploadEnabled: true, [forbidden]: "untrusted" }));
    assert.equal(invalid.status, 400);
  }
  const notFound = await createUploadDestinationSettingsPatchHandler({ ...dependencies(), setEnabled: async () => null })(request({ destinationId: setting.destinationId, uploadEnabled: true }));
  assert.equal(notFound.status, 404);
});

test("settings API hides repository diagnostics", async () => {
  const get = await createUploadDestinationSettingsListHandler({ ...dependencies(), listSettings: async () => { throw new Error("internal-db-diagnostic"); } })();
  assert.equal(get.status, 500);
  assert.equal(JSON.stringify(await get.json()).includes("internal-db-diagnostic"), false);
  const patch = await createUploadDestinationSettingsPatchHandler({ ...dependencies(), setEnabled: async () => { throw new Error("internal-db-diagnostic"); } })(request({ destinationId: setting.destinationId, uploadEnabled: true }));
  assert.equal(patch.status, 500);
  assert.equal(JSON.stringify(await patch.json()).includes("internal-db-diagnostic"), false);
});
