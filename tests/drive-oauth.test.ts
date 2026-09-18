import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { hasMinimumRole } from "../src/lib/auth/permissions.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import {
  driveOAuthScope,
  driveOAuthStateCookie,
  driveOAuthStateMaxAgeSeconds,
  createDriveOAuthClient,
  generateDriveOAuthState,
  getDriveAuthorizationUrl,
  getDriveOAuthConfig,
  getDriveOAuthRedirectUri,
  matchesDriveOAuthState,
} from "../src/lib/google/drive-oauth.ts";
import { createDriveAuthorizeHandler, createDriveCallbackHandler } from "../src/lib/google/drive-setup.ts";
import { DriveServiceError } from "../src/lib/google/drive-types.ts";
import type { drive_v3 } from "googleapis";

const admin: AuthorizedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const authorized: AuthorizationResult = { kind: "authorized", user: admin };

function callbackRequest(query: string, stateCookie?: string) {
  return new NextRequest(`http://localhost:3000/api/admin/drive-setup/callback?${query}`, {
    headers: stateCookie === undefined ? {} : { cookie: `${driveOAuthStateCookie}=${stateCookie}` },
  });
}

function withDriveEnv<T>(operation: () => T): T {
  const previous = {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  };
  process.env.GOOGLE_DRIVE_CLIENT_ID = "drive-client-id";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "drive-client-secret";
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = "drive-refresh-token";
  try {
    return operation();
  } finally {
    if (previous.clientId === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID; else process.env.GOOGLE_DRIVE_CLIENT_ID = previous.clientId;
    if (previous.clientSecret === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_SECRET; else process.env.GOOGLE_DRIVE_CLIENT_SECRET = previous.clientSecret;
    if (previous.refreshToken === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN; else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = previous.refreshToken;
  }
}

async function withDriveEnvAsync<T>(operation: () => Promise<T>): Promise<T> {
  const previous = {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  };
  process.env.GOOGLE_DRIVE_CLIENT_ID = "drive-client-id";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "drive-client-secret";
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = "drive-refresh-token";
  try {
    return await operation();
  } finally {
    if (previous.clientId === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID; else process.env.GOOGLE_DRIVE_CLIENT_ID = previous.clientId;
    if (previous.clientSecret === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_SECRET; else process.env.GOOGLE_DRIVE_CLIENT_SECRET = previous.clientSecret;
    if (previous.refreshToken === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN; else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = previous.refreshToken;
  }
}

test("Drive OAuth loads the dedicated client credentials and refresh token", () => withDriveEnv(() => {
  assert.deepEqual(getDriveOAuthConfig(true), {
    clientId: "drive-client-id",
    clientSecret: "drive-client-secret",
    refreshToken: "drive-refresh-token",
  });
  const client = createDriveOAuthClient("http://localhost:3000/api/admin/drive-setup/callback");
  client.setCredentials({ refresh_token: getDriveOAuthConfig(true).refreshToken });
  assert.equal(client.credentials.refresh_token, "drive-refresh-token");
  assert.equal(new URL(getDriveAuthorizationUrl("http://localhost:3000/api/admin/drive-setup/callback", "state")).searchParams.get("client_id"), "drive-client-id");
}));

test("Drive OAuth authorization requests preserve the approved drive.file scope", () => withDriveEnv(() => {
  const url = new URL(getDriveAuthorizationUrl("http://localhost:3000/api/admin/drive-setup/callback", "state-value"));
  assert.equal(url.searchParams.get("scope"), driveOAuthScope);
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
}));

test("Drive OAuth rejects missing credentials without exposing their values", () => {
  const previous = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  try {
    assert.throws(() => getDriveOAuthConfig(), (error: unknown) => error instanceof DriveServiceError && !error.message.includes("drive-client"));
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_SECRET; else process.env.GOOGLE_DRIVE_CLIENT_SECRET = previous;
  }
});

test("Drive OAuth state is high entropy and uses constant-time equality", () => {
  const first = generateDriveOAuthState();
  const second = generateDriveOAuthState();
  assert.notEqual(first, second);
  assert.equal(matchesDriveOAuthState(first, first), true);
  assert.equal(matchesDriveOAuthState(first, second), false);
  assert.equal(matchesDriveOAuthState(first, null), false);
  assert.equal(matchesDriveOAuthState(undefined, first), false);
});

test("Drive OAuth redirect URI is the dedicated callback route", () => {
  assert.equal(getDriveOAuthRedirectUri("http://localhost:3000/documents"), "http://localhost:3000/api/admin/drive-setup/callback");
});

test("Drive authorize route requires an ACTIVE ADMIN and sets a short-lived HttpOnly state cookie", async () => withDriveEnvAsync(async () => {
  for (const authorization of [
    { kind: "unauthenticated" },
    { kind: "inactive" },
    { kind: "not-authorized" },
    { kind: "authorized", user: { ...admin, role: "STAFF" as const } },
  ] satisfies AuthorizationResult[]) {
    const rejected = await createDriveAuthorizeHandler({ getAuthorization: async () => authorization })(new NextRequest("http://localhost:3000/api/admin/drive-setup/authorize"));
    assert.equal(rejected.status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
  }

  const handler = createDriveAuthorizeHandler({ getAuthorization: async () => authorized });
  const response = await handler(new NextRequest("http://localhost:3000/api/admin/drive-setup/authorize"));
  assert.equal(response.status, 307);
  const stateCookie = response.cookies.get(driveOAuthStateCookie);
  assert.ok(stateCookie?.value);
  assert.equal(stateCookie?.httpOnly, true);
  assert.equal(stateCookie?.sameSite, "lax");
  assert.equal(stateCookie?.path, "/api/admin/drive-setup");
  assert.equal(stateCookie?.maxAge, driveOAuthStateMaxAgeSeconds);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(new URL(response.headers.get("location")!).searchParams.get("scope"), driveOAuthScope);
  assert.equal(hasMinimumRole(admin.role, "ADMIN"), true);
}));

test("Drive setup callback rejects missing, malformed, mismatched, and missing-cookie state while consuming the cookie", async () => {
  const handler = createDriveCallbackHandler({ getAuthorization: async () => authorized, exchangeCode: async () => null });
  for (const request of [
    callbackRequest("code=code"),
    callbackRequest("code=code&state=not-base64!!", "expected"),
    callbackRequest("code=code&state=wrong", "expected"),
    callbackRequest("code=code&state=expected"),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 400);
    assert.equal(response.cookies.get(driveOAuthStateCookie)?.maxAge, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.doesNotMatch(await response.text(), /not-base64|expected/i);
  }
});

test("Drive setup callback is ACTIVE ADMIN-only and consumes state on authorization failure", async () => {
  for (const authorization of [
    { kind: "unauthenticated" },
    { kind: "inactive" },
    { kind: "not-authorized" },
    { kind: "authorized", user: { ...admin, role: "VIEWER" as const } },
  ] satisfies AuthorizationResult[]) {
    const handler = createDriveCallbackHandler({ getAuthorization: async () => authorization, exchangeCode: async () => null });
    const response = await handler(callbackRequest("code=code&state=expected", "expected"));
    assert.equal(response.status, authorization.kind === "unauthenticated" ? 401 : 403);
    assert.equal(response.cookies.get(driveOAuthStateCookie)?.maxAge, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("Drive setup callback consumes state after OAuth error, missing code, null exchange, and exchange exception without diagnostics", async () => {
  const handler = createDriveCallbackHandler({ getAuthorization: async () => authorized, exchangeCode: async () => null });
  for (const request of [
    callbackRequest("error=access_denied&state=expected", "expected"),
    callbackRequest("state=expected", "expected"),
    callbackRequest("code=secret-authorization-code&state=expected", "expected"),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, request.nextUrl.searchParams.has("code") ? 502 : 400);
    assert.equal(response.cookies.get(driveOAuthStateCookie)?.maxAge, 0);
    assert.doesNotMatch(await response.text(), /secret-authorization-code|access_denied|refresh-token|drive-refresh-token|client-secret/i);
  }

  const thrown = await createDriveCallbackHandler({
    getAuthorization: async () => authorized,
    exchangeCode: async () => { throw new Error("provider token endpoint details"); },
  })(callbackRequest("code=secret-authorization-code&state=expected", "expected"));
  assert.equal(thrown.status, 502);
  assert.equal(thrown.cookies.get(driveOAuthStateCookie)?.maxAge, 0);
  assert.doesNotMatch(await thrown.text(), /provider|token endpoint|secret-authorization-code/i);
});

test("Drive setup callback presents the refresh token only in the one-time admin setup response and consumes its state", async () => {
  let exchangedRedirectUri = "";
  const handler = createDriveCallbackHandler({
    getAuthorization: async () => authorized,
    exchangeCode: async (_code, redirectUri) => {
      exchangedRedirectUri = redirectUri;
      return { refreshToken: "one-time-refresh-token", drive: {} as drive_v3.Drive };
    },
    ensureRootFolder: async () => "rootFolderId_12345",
  });
  const request = callbackRequest("code=secret-authorization-code&state=expected", "expected");
  const response = await handler(request);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /GOOGLE_DRIVE_REFRESH_TOKEN=one-time-refresh-token/);
  assert.match(body, /GOOGLE_DRIVE_ROOT_FOLDER_ID=rootFolderId_12345/);
  assert.doesNotMatch(body, /access-token|client-secret/i);
  assert.doesNotMatch(body, /secret-authorization-code|state=expected/i);
  assert.equal(exchangedRedirectUri, "http://localhost:3000/api/admin/drive-setup/callback");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.cookies.get(driveOAuthStateCookie)?.maxAge, 0);

  const replay = await handler(callbackRequest("code=secret-authorization-code&state=expected"));
  assert.equal(replay.status, 400);
});
