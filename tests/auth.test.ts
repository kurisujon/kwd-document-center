import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { createAuthCallbackHandler } from "../src/lib/auth/callback.ts";
import { getAuthorization } from "../src/lib/auth/server.ts";
import { authenticationFailureRedirectPath, getAuthorizationRedirectPath } from "../src/lib/auth/redirect.ts";
import type { AuthorizedUser } from "../src/lib/auth/types.ts";
import { updateSession } from "../src/lib/supabase/proxy.ts";

const authorizedUser: AuthorizedUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

function callbackRequest(search = "") {
  return new NextRequest(`http://localhost/auth/callback${search}`);
}

function location(response: Response) {
  return new URL(response.headers.get("location") ?? "", "http://localhost").pathname
    + new URL(response.headers.get("location") ?? "", "http://localhost").search;
}

test("auth callback preserves safe internal redirects and writes only server-managed callback cookies", async () => {
  const handler = createAuthCallbackHandler({
    isSupabaseConfigured: () => true,
    exchangeCodeForSession: async (_code, _request, response) => {
      response.cookies.set("sb-session", "server-managed", { httpOnly: true });
      return { error: null };
    },
  });
  const response = await handler(callbackRequest("?code=valid&next=/admin/users"));
  assert.equal(response.status, 307);
  assert.equal(location(response), "/admin/users");
  assert.equal(response.cookies.get("sb-session")?.value, "server-managed");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("auth callback rejects missing/unsafe redirects and suppresses provider diagnostics", async () => {
  const configured = () => true;
  const missingCode = await createAuthCallbackHandler({ isSupabaseConfigured: configured })(callbackRequest("?next=/documents"));
  assert.equal(location(missingCode), authenticationFailureRedirectPath);
  assert.equal(missingCode.headers.get("cache-control"), "private, no-store");

  const unsafeRedirect = await createAuthCallbackHandler({
    isSupabaseConfigured: configured,
    exchangeCodeForSession: async () => ({ error: null }),
  })(callbackRequest("?code=valid&next=https://attacker.example"));
  assert.equal(location(unsafeRedirect), "/documents");

  for (const exchangeCodeForSession of [
    async () => ({ error: { message: "SQLSTATE provider diagnostic" } }),
    async () => { throw new Error("token=secret provider transport failure"); },
  ]) {
    const response = await createAuthCallbackHandler({ isSupabaseConfigured: configured, exchangeCodeForSession })(callbackRequest("?code=valid"));
    assert.equal(location(response), authenticationFailureRedirectPath);
    assert.doesNotMatch(response.headers.get("location") ?? "", /SQLSTATE|provider|token|secret/i);
  }
});

test("auth callback returns the existing configuration-safe redirect", async () => {
  const response = await createAuthCallbackHandler({ isSupabaseConfigured: () => false })(callbackRequest("?code=valid"));
  assert.equal(location(response), "/login?error=configuration");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("getAuthorization distinguishes sessions, authorization records, and infrastructure failures", async () => {
  const base = {
    isSupabaseConfigured: () => true,
    getSessionUser: async () => ({ email: "ADMIN@EXAMPLE.TEST" }),
    findAuthorizedUser: async () => authorizedUser,
  };
  assert.deepEqual(await getAuthorization(base), { kind: "authorized", user: authorizedUser });
  assert.deepEqual(await getAuthorization({ ...base, getSessionUser: async () => null }), { kind: "unauthenticated" });
  assert.deepEqual(await getAuthorization({ ...base, findAuthorizedUser: async () => ({ ...authorizedUser, status: "INACTIVE" }) }), { kind: "inactive" });
  assert.deepEqual(await getAuthorization({ ...base, getSessionUser: async () => { throw new Error("provider token details"); } }), { kind: "auth-error" });
  assert.deepEqual(await getAuthorization({ ...base, findAuthorizedUser: async () => { throw new Error("database transport details"); } }), { kind: "auth-error" });
  assert.deepEqual(await getAuthorization({ ...base, findAuthorizedUser: async () => null }), { kind: "not-authorized" });
  assert.equal(getAuthorizationRedirectPath("auth-error"), authenticationFailureRedirectPath);
});

test("proxy refresh success preserves server-managed cookies and failures fail closed without a redirect", async () => {
  const request = new NextRequest("http://localhost/documents");
  const response = await updateSession(request, {
    isSupabaseConfigured: () => true,
    getSupabaseEnv: () => ({ url: "http://supabase.invalid", anonKey: "public-test-key" }),
    createServerClient: ((_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void } }) => {
      options.cookies.setAll([{ name: "sb-session", value: "refreshed", options: { httpOnly: true } }]);
      return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
    }) as never,
  });
  assert.equal(response.cookies.get("sb-session")?.value, "refreshed");

  const failed = await updateSession(request, {
    isSupabaseConfigured: () => true,
    getSupabaseEnv: () => ({ url: "http://supabase.invalid", anonKey: "public-test-key" }),
    createServerClient: (() => ({ auth: { getUser: async () => { throw new Error("provider session token failure"); } } })) as never,
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.headers.get("location"), null);
  assert.equal(failed.cookies.get("sb-session"), undefined);
});

test("auth hardening does not log session or provider diagnostics", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/lib/auth/callback.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(files.join("\n"), /console\.(?:log|debug|error)|error\.message|access_token|refresh_token/i);
});
