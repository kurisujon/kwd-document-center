import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

function isLoopbackAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
}

async function defaultHostLookup(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function assertDisposableLocalDatabase(urlValue: string, hostLookup: HostLookup = defaultHostLookup) {
  const url = new URL(urlValue);
  assert.ok(
    url.protocol === "postgres:" || url.protocol === "postgresql:",
    "The destructive test database URL must use PostgreSQL.",
  );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port || "5432";

  if (isIP(hostname) !== 0) {
    assert.ok(isLoopbackAddress(hostname), "The destructive test only accepts a disposable loopback database.");
    return { hostname, port, addresses: [hostname] };
  }

  assert.equal(hostname.toLowerCase(), "localhost", "The destructive test only accepts localhost or numeric loopback addresses.");
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await hostLookup(hostname);
  } catch {
    throw new Error("The destructive test could not resolve localhost to a loopback address.");
  }
  assert.ok(resolved.length > 0, "The destructive test could not resolve localhost to a loopback address.");
  assert.ok(
    resolved.every(({ address }) => isLoopbackAddress(address)),
    "The destructive test only accepts localhost when every resolved address is loopback.",
  );
  return { hostname, port, addresses: resolved.map(({ address }) => address) };
}
