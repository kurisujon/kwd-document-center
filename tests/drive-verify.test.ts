import assert from "node:assert/strict";
import test from "node:test";
import { createDriveVerifyHandler } from "../src/lib/google/drive-verify.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import { DriveServiceError, type DriveFileMetadata, type DriveService } from "../src/lib/google/drive-types.ts";

const admin: AuthorizedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const targetMetadata = new Map([
  ["192ocZvz5MS87jlJ5CiU_Ged3btMnT55_", { name: "KWD DOCUMENT CENTER" }],
  ["1P2hdxEHHJ_a30jgctwIGgDZGM2DtVi8f", { name: "ADMIN DOCUMENTS" }],
  ["1yT5VGngCc_PlFJcFTKohT7elEYeCWlBh", { name: "AGENDA" }],
  ["1T4YtlO64H7MVGp_SfazS39XUvg0fPPDn", { name: "DTR SUMMARY" }],
  ["1mDjbYwlBCTSfgB4zDgGl2MkS8ukWnTG7", { name: "MEMORANDUM" }],
  ["1fvXkXnConVoiU0ERGQJxlWgxHctSAmse", { name: "REFERENCE & TEMPLATES" }],
]);

const authorized = (): AuthorizationResult => ({ kind: "authorized", user: admin });

function driveMock(overrides: Partial<Record<string, Partial<DriveFileMetadata> | Error>> = {}) {
  const calls: string[] = [];
  const drive: Pick<DriveService, "getMetadata"> = {
    async getMetadata(id) {
      calls.push(id);
      const override = overrides[id];
      if (override instanceof Error) throw override;
      const target = targetMetadata.get(id);
      if (!target) throw new Error("unexpected ID");
      return {
        id,
        name: target.name,
        mimeType: "application/vnd.google-apps.folder",
        trashed: false,
        webViewLink: "https://drive.example.test/private-link",
        ...override,
      };
    },
  };
  return { calls, drive };
}

function handler(authorization: AuthorizationResult = authorized(), overrides: Partial<Record<string, Partial<DriveFileMetadata> | Error>> = {}) {
  const mock = driveMock(overrides);
  return {
    calls: mock.calls,
    get response() {
      return createDriveVerifyHandler({ getAuthorization: async () => authorization, createDriveService: () => mock.drive })(new Request("http://localhost/api/admin/drive-verify"));
    },
  };
}

test("Drive verification rejects unauthenticated and non-ADMIN requests without creating a Drive service", async () => {
  for (const authorization of [
    { kind: "unauthenticated" },
    { kind: "inactive" },
    { kind: "not-authorized" },
    { kind: "authorized", user: { ...admin, role: "STAFF" as const } },
  ] satisfies AuthorizationResult[]) {
    let createCalls = 0;
    const response = await createDriveVerifyHandler({
      getAuthorization: async () => authorization,
      createDriveService: () => { createCalls += 1; return driveMock().drive; },
    })(new Request("http://localhost/api/admin/drive-verify"));
    assert.equal(response.status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal(createCalls, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

test("ACTIVE ADMIN verification checks exactly the six fixed IDs using getMetadata only", async () => {
  const run = handler();
  const response = await run.response;
  const body = await response.json() as { ok: boolean; checks: Array<{ expectedId: string; pass: boolean }> };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.checks.length, 6);
  assert.equal(targetMetadata.get("192ocZvz5MS87jlJ5CiU_Ged3btMnT55_")?.name, "KWD DOCUMENT CENTER");
  assert.deepEqual(run.calls, [...targetMetadata.keys()]);
  assert.deepEqual(body.checks.map((check) => check.expectedId), [...targetMetadata.keys()]);
});

test("request-supplied IDs cannot influence fixed verification targets", async () => {
  const mock = driveMock();
  const response = await createDriveVerifyHandler({
    getAuthorization: async () => authorized(),
    createDriveService: () => mock.drive,
  })(new Request("http://localhost/api/admin/drive-verify?folderId=attacker-controlled-id&id=attacker-controlled-id"));
  assert.equal(response.status, 200);
  assert.equal(mock.calls.includes("attacker-controlled-id"), false);
  assert.equal(mock.calls.length, 6);
});

test("metadata mismatches safely fail their individual checks", async () => {
  const ids = [...targetMetadata.keys()];
  for (const [id, override] of [
    [ids[0], { id: "different-id" }],
    [ids[1], { mimeType: "application/pdf" }],
    [ids[2], { trashed: true }],
    [ids[3], { name: "Unexpected name" }],
  ] as const) {
    const response = await handler(authorized(), { [id]: override }).response;
    const body = await response.json() as { ok: boolean; checks: Array<{ expectedId: string; pass: boolean; failure?: string }> };
    assert.equal(body.ok, false);
    const check = body.checks.find((candidate) => candidate.expectedId === id)!;
    assert.equal(check.pass, false);
    assert.equal(check.failure, "MISMATCH");
  }
});

test("provider failures are classified and sanitized", async () => {
  const id = [...targetMetadata.keys()][0];
  const response = await handler(authorized(), { [id]: new DriveServiceError("TRANSIENT") }).response;
  const body = await response.json() as { ok: boolean; checks: Array<{ expectedId: string; failure?: string; actualName: string | null }> };
  assert.equal(body.ok, false);
  const check = body.checks.find((candidate) => candidate.expectedId === id)!;
  assert.equal(check.failure, "TRANSIENT");
  assert.equal(check.actualName, null);
  assert.doesNotMatch(JSON.stringify(body), /private-link|token|secret|stack/i);
});
