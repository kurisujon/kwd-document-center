import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import {
  approvedFolders,
  createDriveRecoveryAuthorizeHandler,
  createDriveRecoveryCallbackHandler,
  driveRecoveryRedirectUri,
  driveRecoveryStateCookie,
  driveRecoveryStateMaxAgeSeconds,
  getRecoveryAuthorizationUrl,
  verifyApprovedFolderAccess,
} from "../src/lib/google/drive-recovery.ts";
import { driveOAuthScope } from "../src/lib/google/drive-oauth.ts";

const admin: AuthorizedUser = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE" };
const authorized: AuthorizationResult = { kind: "authorized", user: admin };
const selectedIds = approvedFolders.map(({ id }) => id).join(",");
const expectedFolderIds = [
  "192ocZvz5MS87jlJ5CiU_Ged3btMnT55_", "1P2hdxEHHJ_a30jgctwIGgDZGM2DtVi8f", "1LyJCNs26Z0oLRIhWSVPvC6KmXd0GSuaq",
  "1yT5VGngCc_PlFJcFTKohT7elEYeCWlBh", "13IXn9PuW8RLnjEhriII9WbtCnU6PkZO0", "1S6AHWn1Fm-h96LP3kPmDPZUWX2Oe70Qa",
  "1kxB-XjOyjTezYDUxgFbsq8LYaNC3OOTU", "1YLFO7oq4mJB9KA9du5Jll-hav2d14UFM", "1T4YtlO64H7MVGp_SfazS39XUvg0fPPDn",
  "1N7MLqNfyoAyYsEVENC-G0jTG2qfG8rCE", "1tOl0lIoOtS7-b0H5C58BeEFw4rnQfsPk", "1mDjbYwlBCTSfgB4zDgGl2MkS8ukWnTG7",
  "13SmHoms2o9iMOHKW9YW3uSHHJVphJJU4", "17uX3k-c3jsshzmt2NcVJZmLTjPpma0jf", "17LIek68dapTXePXTMy36bwO5lNCWdtzF",
  "1fvXkXnConVoiU0ERGQJxlWgxHctSAmse", "1pkPwtH5erTokHNP-HOW_ITuIhXhMev5J", "1ZlnOo-UJA6MHWq0yZPfaHbcM855AkP0O",
];
const freshExchange = () => ({ refreshToken: "fresh-recovery-token", credentials: { access_token: "new-access-token", refresh_token: "fresh-recovery-token", expiry_date: 1_800_000_000_000 } });
const verifiedFolders = async () => ({ kind: "valid" as const });

function callbackRequest(query: string, stateCookie = "expected-state") {
  return new NextRequest(`${driveRecoveryRedirectUri}?${query}`, { headers: { cookie: `${driveRecoveryStateCookie}=${stateCookie}` } });
}

function authorizeRequest(query = "") {
  return new NextRequest(`https://kwd-document-center.vercel.app/api/admin/drive-recovery/authorize?${query}`);
}

function validQuery(extra = "") {
  return `state=expected-state&scope=${encodeURIComponent(driveOAuthScope)}&picked_file_ids=${encodeURIComponent(selectedIds)}&code=secret-code${extra}`;
}

test("Drive recovery authorize requires an ACTIVE ADMIN and never starts Picker authorization for rejected users", async () => {
  for (const authorization of [
    { kind: "unauthenticated" },
    { kind: "inactive" },
    { kind: "not-authorized" },
    { kind: "authorized", user: { ...admin, role: "STAFF" as const } },
    { kind: "authorized", user: { ...admin, role: "VIEWER" as const } },
  ] satisfies AuthorizationResult[]) {
    let urlCalls = 0;
    const response = await createDriveRecoveryAuthorizeHandler({
      getAuthorization: async () => authorization,
      getAuthorizationUrl: () => { urlCalls += 1; return "https://example.test"; },
    })(authorizeRequest("file_ids=attacker-controlled-id"));
    assert.equal(response.status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal(urlCalls, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

test("Drive recovery authorization URL uses only drive.file and the fixed 18-folder Picker set", async () => {
  const previous = { clientId: process.env.GOOGLE_DRIVE_CLIENT_ID, clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET };
  process.env.GOOGLE_DRIVE_CLIENT_ID = "drive-storage-client";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "drive-storage-secret";
  try {
    const first = getRecoveryAuthorizationUrl("first-state");
    const second = getRecoveryAuthorizationUrl("second-state");
    const url = new URL(first);
    assert.equal(url.searchParams.get("client_id"), "drive-storage-client");
    assert.equal(url.searchParams.get("redirect_uri"), driveRecoveryRedirectUri);
    assert.equal(url.searchParams.get("scope"), driveOAuthScope);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("trigger_onepick"), "true");
    assert.equal(url.searchParams.get("allow_multiple"), "true");
    assert.equal(url.searchParams.get("allow_folder_selection"), "true");
    assert.equal(approvedFolders.length, 18);
    assert.deepEqual(approvedFolders.map(({ id }) => id), expectedFolderIds);
    assert.deepEqual(url.searchParams.get("file_ids")?.split(","), expectedFolderIds);
    assert.deepEqual(approvedFolders.slice(2).map(({ id }) => id), expectedFolderIds.slice(2));
    assert.deepEqual(approvedFolders.slice(0, 2).map(({ label, id }) => ({ label, id })), [
      { label: "KWD DOCUMENT CENTER", id: "192ocZvz5MS87jlJ5CiU_Ged3btMnT55_" },
      { label: "ADMIN DOCUMENTS", id: "1P2hdxEHHJ_a30jgctwIGgDZGM2DtVi8f" },
    ]);
    assert.equal(url.searchParams.get("file_ids")?.includes("attacker-controlled-id"), false);
    assert.equal(new URL(second).searchParams.get("state") === url.searchParams.get("state"), false);
  } finally {
    if (previous.clientId === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID; else process.env.GOOGLE_DRIVE_CLIENT_ID = previous.clientId;
    if (previous.clientSecret === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_SECRET; else process.env.GOOGLE_DRIVE_CLIENT_SECRET = previous.clientSecret;
  }
});

test("Drive recovery authorize issues an isolated high-entropy HttpOnly callback-scoped state cookie", async () => {
  const response = await createDriveRecoveryAuthorizeHandler({ getAuthorization: async () => authorized, getAuthorizationUrl: (state) => `https://example.test/?state=${state}` })(authorizeRequest());
  const state = response.cookies.get(driveRecoveryStateCookie);
  assert.ok(state?.value && state.value.length >= 40);
  assert.equal(state?.httpOnly, true);
  assert.equal(state?.sameSite, "lax");
  assert.equal(state?.path, "/api/admin/drive-recovery");
  assert.equal(state?.maxAge, driveRecoveryStateMaxAgeSeconds);
});

test("Drive recovery callback rejects non-admin, missing state, mismatched state, and OAuth errors while consuming state", async () => {
  for (const authorization of [
    { kind: "unauthenticated" },
    { kind: "inactive" },
    { kind: "authorized", user: { ...admin, role: "STAFF" as const } },
    { kind: "authorized", user: { ...admin, role: "VIEWER" as const } },
  ] satisfies AuthorizationResult[]) {
    const response = await createDriveRecoveryCallbackHandler({ getAuthorization: async () => authorization })(callbackRequest(validQuery()));
    assert.equal(response.status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal(response.cookies.get(driveRecoveryStateCookie)?.maxAge, 0);
  }
  const handler = createDriveRecoveryCallbackHandler({ getAuthorization: async () => authorized });
  for (const request of [
    callbackRequest(`scope=${encodeURIComponent(driveOAuthScope)}`, "expected-state"),
    callbackRequest(validQuery().replace("expected-state", "wrong-state")),
    callbackRequest("state=expected-state&error=access_denied"),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 400);
    assert.equal(response.cookies.get(driveRecoveryStateCookie)?.maxAge, 0);
    assert.doesNotMatch(await response.text(), /access_denied|secret-code|expected-state/i);
  }
});

test("Drive recovery validates the complete fixed folder selection before server-side token exchange", async () => {
  let exchangeCalls = 0;
  const handler = createDriveRecoveryCallbackHandler({ getAuthorization: async () => authorized, exchangeCode: async () => { exchangeCalls += 1; return freshExchange(); }, verifyFolders: verifiedFolders });
  const incomplete = await handler(callbackRequest(validQuery().replace(`&picked_file_ids=${encodeURIComponent(selectedIds)}`, `&picked_file_ids=${encodeURIComponent(selectedIds.split(",").slice(0, -1).join(","))}`)));
  assert.equal(incomplete.status, 400);
  assert.deepEqual((await incomplete.json() as { error: { code: string; missing: string[] } }).error, { code: "INCOMPLETE_FOLDER_SELECTION", message: "Select every approved Production folder before continuing.", missing: [approvedFolders.at(-1)!.label] });
  const unexpected = await handler(callbackRequest(validQuery().replace(
    encodeURIComponent(selectedIds),
    encodeURIComponent(`${selectedIds},attacker-controlled-id`),
  )));
  assert.equal(unexpected.status, 400);
  assert.equal((await unexpected.json() as { error: { code: string } }).error.code, "INVALID_FOLDER_SELECTION");
  const missingCode = await handler(callbackRequest(validQuery().replace("&code=secret-code", "")));
  assert.equal(missingCode.status, 400);
  assert.equal((await missingCode.json() as { error: { code: string } }).error.code, "MISSING_CODE");
  assert.equal(exchangeCalls, 0);
});

test("Drive recovery exchanges only after complete selection, verifies fresh credentials, and returns a protected handoff", async () => {
  let receivedCode = "";
  let receivedRedirectUri = "";
  let verificationCredentials: unknown;
  const previousRefreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = "stale-production-token";
  const response = await createDriveRecoveryCallbackHandler({
    getAuthorization: async () => authorized,
    exchangeCode: async (code, redirectUri) => { receivedCode = code; receivedRedirectUri = redirectUri; return freshExchange(); },
    verifyFolders: async (credentials) => { verificationCredentials = credentials; return { kind: "valid" }; },
  })(callbackRequest(validQuery()));
  if (previousRefreshToken === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN; else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = previousRefreshToken;
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(receivedCode, "secret-code");
  assert.equal(receivedRedirectUri, driveRecoveryRedirectUri);
  assert.deepEqual(verificationCredentials, freshExchange().credentials);
  assert.match(body, /DO NOT SCREENSHOT THIS TOKEN/);
  assert.match(body, /COPY IT DIRECTLY INTO THE VERCEL PRODUCTION ENVIRONMENT VARIABLE/);
  assert.match(body, /GOOGLE_DRIVE_REFRESH_TOKEN=fresh-recovery-token/);
  assert.doesNotMatch(body, /secret-code|access.token|client.secret|raw OAuth/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.cookies.get(driveRecoveryStateCookie)?.maxAge, 0);
});

test("Drive recovery safely rejects missing refresh tokens and token provider diagnostics", async () => {
  for (const exchangeCode of [
    async () => ({ refreshToken: null, credentials: freshExchange().credentials }),
    async () => { throw new Error("provider response includes secret authorization code"); },
  ]) {
    const response = await createDriveRecoveryCallbackHandler({ getAuthorization: async () => authorized, exchangeCode })(callbackRequest(validQuery()));
    assert.equal(response.status, 502);
    assert.equal(response.cookies.get(driveRecoveryStateCookie)?.maxAge, 0);
    assert.doesNotMatch(await response.text(), /provider|secret|authorization code/i);
  }
});

test("complete callback IDs never cause a handoff until all server-side checks pass", async () => {
  const response = await createDriveRecoveryCallbackHandler({
    getAuthorization: async () => authorized,
    exchangeCode: async () => freshExchange(),
    verifyFolders: async () => ({ kind: "access", folders: [approvedFolders[2].label] }),
  })(callbackRequest(validQuery()));
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.match(body, /DRIVE_FOLDER_ACCESS_INCOMPLETE/);
  assert.match(body, new RegExp(approvedFolders[2].label));
  assert.doesNotMatch(body, /fresh-recovery-token|new-access-token|secret-code/i);
});

test("server-side verification checks exactly all 18 fixed folder IDs with metadata reads", async () => {
  const calls: string[] = [];
  const result = await verifyApprovedFolderAccess(freshExchange().credentials, {
    getMetadata: async (id) => {
      calls.push(id);
      return { id, mimeType: "application/vnd.google-apps.folder", trashed: false };
    },
  });
  assert.deepEqual(result, { kind: "valid" });
  assert.deepEqual(calls, expectedFolderIds);
  assert.equal(calls.length, 18);
});

test("server-side folder verification rejects access, transient, malformed, and partial results without a handoff", async () => {
  const cases = [
    { name: "403", getMetadata: async () => { throw { response: { status: 403, data: "private provider details" } }; }, expected: "DRIVE_FOLDER_ACCESS_INCOMPLETE" },
    { name: "404", getMetadata: async () => { throw { response: { status: 404 } }; }, expected: "DRIVE_FOLDER_ACCESS_INCOMPLETE" },
    { name: "transient", getMetadata: async () => { throw { response: { status: 503 } }; }, expected: "DRIVE_FOLDER_VERIFICATION_UNAVAILABLE" },
    { name: "wrong ID", getMetadata: async () => ({ id: "wrong-id", mimeType: "application/vnd.google-apps.folder", trashed: false }), expected: "DRIVE_FOLDER_VERIFICATION_FAILED" },
    { name: "non-folder", getMetadata: async (id: string) => ({ id, mimeType: "application/pdf", trashed: false }), expected: "DRIVE_FOLDER_VERIFICATION_FAILED" },
    { name: "trashed", getMetadata: async (id: string) => ({ id, mimeType: "application/vnd.google-apps.folder", trashed: true }), expected: "DRIVE_FOLDER_VERIFICATION_FAILED" },
  ];
  for (const scenario of cases) {
    const verification = await verifyApprovedFolderAccess(freshExchange().credentials, { getMetadata: scenario.getMetadata });
    const response = await createDriveRecoveryCallbackHandler({
      getAuthorization: async () => authorized,
      exchangeCode: async () => freshExchange(),
      verifyFolders: async () => verification,
    })(callbackRequest(validQuery()));
    const body = await response.text();
    assert.match(body, new RegExp(scenario.expected), scenario.name);
    assert.doesNotMatch(body, /fresh-recovery-token|new-access-token|private provider details|secret-code/i, scenario.name);
  }

  const adminDocuments = approvedFolders[1];
  const partial = await verifyApprovedFolderAccess(freshExchange().credentials, {
    getMetadata: async (id) => id === adminDocuments.id
      ? { id, mimeType: "application/vnd.google-apps.folder", trashed: true }
      : { id, mimeType: "application/vnd.google-apps.folder", trashed: false },
  });
  assert.deepEqual(partial, { kind: "failed", folders: [adminDocuments.label] });
  const partialResponse = await createDriveRecoveryCallbackHandler({
    getAuthorization: async () => authorized,
    exchangeCode: async () => freshExchange(),
    verifyFolders: async () => partial,
  })(callbackRequest(validQuery()));
  assert.equal(partialResponse.status, 502);
  assert.doesNotMatch(await partialResponse.text(), /fresh-recovery-token|new-access-token/i);
});

test("Drive recovery contains no root provisioning or Drive write path", async () => {
  const source = await readFile(new URL("../src/lib/google/drive-recovery.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ensureRootDriveFolder|files\.(?:create|update|delete|list)|generateFileId|\.upload\(/);
  assert.match(source, /files\.get/);
  assert.doesNotMatch(source, /console\.(?:log|error).*refreshToken|logOperationalFailure\([^)]*refreshToken/);
});
