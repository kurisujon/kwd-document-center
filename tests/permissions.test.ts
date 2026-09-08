import assert from "node:assert/strict";
import test from "node:test";
import { hasMinimumRole } from "../src/lib/auth/permissions.ts";
import { authenticationFailureRedirectPath, getAuthorizationRedirectPath, getSafeRedirectPath } from "../src/lib/auth/redirect.ts";

test("a role can perform actions at its own level", () => {
  assert.equal(hasMinimumRole("STAFF", "STAFF"), true);
});

test("higher roles are allowed and lower roles are denied", () => {
  assert.equal(hasMinimumRole("ADMIN", "STAFF"), true);
  assert.equal(hasMinimumRole("VIEWER", "STAFF"), false);
});

test("normal unauthenticated access redirects to login without a session-ended error", () => {
  assert.equal(getAuthorizationRedirectPath("unauthenticated"), "/login");
  assert.notEqual(getAuthorizationRedirectPath("unauthenticated"), authenticationFailureRedirectPath);
});

test("OAuth callback failures retain the authentication-failure redirect", () => {
  assert.equal(authenticationFailureRedirectPath, "/login?error=auth");
});

test("post-auth redirects preserve internal routes, queries, and fragments", () => {
  for (const path of ["/", "/documents", "/documents/upload", "/admin/users", "/documents?q=water#results"]) {
    assert.equal(getSafeRedirectPath(path), path);
  }
});

test("post-auth redirects reject external and ambiguous destinations", () => {
  for (const path of [
    null,
    "",
    "documents",
    "//example.com",
    "///example.com",
    "https://example.com",
    "http://example.com",
    "javascript:alert(1)",
    "/\\example.com",
    "/%2fexample.com",
    "/%5cexample.com",
    "/\texample.com",
    "/\n/example.com",
    "/documents/..//example.com",
    "/documents/%2e%2e//example.com",
  ]) {
    const safePath = getSafeRedirectPath(path);
    assert.equal(safePath, "/documents", `Rejected: ${JSON.stringify(path)}`);
    assert.equal(new URL(safePath, "https://kwd-document-center.invalid").origin, "https://kwd-document-center.invalid");
  }
});
