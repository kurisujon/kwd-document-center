import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { hasMinimumRole } from "../src/lib/auth/permissions.ts";
import type { AuthorizationResult, AuthorizedUser } from "../src/lib/auth/types.ts";
import {
  driveOAuthScope,
  driveOAuthStateCookie,
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

test("Drive authorize route is ADMIN-only and sets an HttpOnly state cookie", async () => withDriveEnvAsync(async () => {
  const handler = createDriveAuthorizeHandler({ getAuthorization: async () => authorized });
  const response = await handler(new NextRequest("http://localhost:3000/api/admin/drive-setup/authorize"));
  assert.equal(response.status, 307);
  const stateCookie = response.cookies.get(driveOAuthStateCookie);
  assert.ok(stateCookie?.value);
  assert.equal(stateCookie?.httpOnly, true);
  assert.equal(new URL(response.headers.get("location")!).searchParams.get("scope"), driveOAuthScope);
  assert.equal(hasMinimumRole(admin.role, "ADMIN"), true);
}));

test("Drive setup callback rejects missing or invalid state", async () => {
  const handler = createDriveCallbackHandler({ getAuthorization: async () => authorized, exchangeCode: async () => null });
  const missing = await handler(new NextRequest("http://localhost:3000/api/admin/drive-setup/callback?code=code"));
  assert.equal(missing.status, 400);

  const invalid = new NextRequest("http://localhost:3000/api/admin/drive-setup/callback?code=code&state=wrong", {
    headers: { cookie: `${driveOAuthStateCookie}=expected` },
  });
  assert.equal((await handler(invalid)).status, 400);
});

test("Drive setup callback is ADMIN-only", async () => {
  const handler = createDriveCallbackHandler({ getAuthorization: async () => ({ kind: "not-authorized" }), exchangeCode: async () => null });
  const response = await handler(new NextRequest("http://localhost:3000/api/admin/drive-setup/callback"));
  assert.equal(response.status, 403);
});

test("Drive setup callback handles missing refresh tokens safely", async () => {
  const handler = createDriveCallbackHandler({ getAuthorization: async () => authorized, exchangeCode: async () => null });
  const request = new NextRequest("http://localhost:3000/api/admin/drive-setup/callback?code=code&state=expected", {
    headers: { cookie: `${driveOAuthStateCookie}=expected` },
  });
  const response = await handler(request);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /refresh-token|drive-refresh-token|client-secret/i);
});

test("Drive setup callback presents the refresh token only in the one-time admin setup response", async () => {
  let exchangedRedirectUri = "";
  const handler = createDriveCallbackHandler({
    getAuthorization: async () => authorized,
    exchangeCode: async (_code, redirectUri) => {
      exchangedRedirectUri = redirectUri;
      return { refreshToken: "one-time-refresh-token", drive: {} as drive_v3.Drive };
    },
    ensureRootFolder: async () => "rootFolderId_12345",
  });
  const request = new NextRequest("http://localhost:3000/api/admin/drive-setup/callback?code=code&state=expected", {
    headers: { cookie: `${driveOAuthStateCookie}=expected` },
  });
  const response = await handler(request);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /GOOGLE_DRIVE_REFRESH_TOKEN=one-time-refresh-token/);
  assert.match(body, /GOOGLE_DRIVE_ROOT_FOLDER_ID=rootFolderId_12345/);
  assert.doesNotMatch(body, /access-token|client-secret/i);
  assert.equal(exchangedRedirectUri, "http://localhost:3000/api/admin/drive-setup/callback");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
});
