import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextResponse } from "next/server";
import { protectedHeaders, protectedJson, protectResponse } from "../src/lib/http/response.ts";
import { logOperationalFailure } from "../src/lib/observability/log.ts";

test("the repository declares the Node 22.x deployment contract", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { engines?: { node?: string } };
  const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8")) as { packages?: { ""?: { engines?: { node?: string } } } };
  assert.equal(packageJson.engines?.node, "22.x");
  assert.equal(packageLock.packages?.[""]?.engines?.node, "22.x");
  assert.equal((await readFile(new URL("../.nvmrc", import.meta.url), "utf8")).trim(), "22.22.2");
});

test("protected responses prevent shared caching and content sniffing", async () => {
  const headers = protectedHeaders({ "X-Test": "preserved" });
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-test"), "preserved");

  const json = protectedJson({ error: { code: "SAFE_ERROR", message: "Try again." } }, 503);
  assert.equal(json.status, 503);
  assert.equal(json.headers.get("cache-control"), "private, no-store");
  assert.equal(json.headers.get("x-content-type-options"), "nosniff");

  const redirect = protectResponse(NextResponse.redirect("https://example.test", 302), { noReferrer: true });
  assert.equal(redirect.headers.get("cache-control"), "private, no-store");
  assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
});

test("protectResponse preserves repeated Set-Cookie headers", () => {
  const response = NextResponse.redirect("https://example.test/documents");
  response.headers.append("Set-Cookie", "cookie-a=value-a; Path=/; HttpOnly");
  response.headers.append("Set-Cookie", "cookie-b=value-b; Path=/; HttpOnly");

  const protectedResponse = protectResponse(response, { noReferrer: true });

  assert.deepEqual(protectedResponse.headers.getSetCookie(), [
    "cookie-a=value-a; Path=/; HttpOnly",
    "cookie-b=value-b; Path=/; HttpOnly",
  ]);
  assert.equal(protectedResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(protectedResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(protectedResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(protectedResponse.headers.get("location"), "https://example.test/documents");
});

test("operational logging accepts only categorized safe fields", async () => {
  const source = await readFile(new URL("../src/lib/observability/log.ts", import.meta.url), "utf8");
  assert.match(source, /JSON\.stringify/);
  assert.doesNotMatch(source, /process\.env|error\.message|stack/i);
});

test("operational logging swallows console failures", () => {
  const originalConsoleError = console.error;
  try {
    console.error = () => {
      throw new Error("simulated logging failure");
    };
    assert.doesNotThrow(() => logOperationalFailure({
      operation: "test.operation",
      outcome: "failure",
      category: "TEST_FAILURE",
      status: 500,
      resourceId: "test-resource",
    }));
  } finally {
    console.error = originalConsoleError;
  }
});
