import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  UPLOAD_SERVER_MAX_DURATION_SECONDS,
  UPLOAD_SERVER_MAX_DURATION_MS,
  UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS,
  UPLOAD_LEASE_DURATION_MS,
} from "../src/lib/documents/upload-timing.ts";
import { UploadQueue } from "../src/lib/documents/upload-queue.ts";

test("upload timing invariants: lease > client timeout > server maxDuration", async () => {
  // 1. Consistency check: server maxDuration in seconds matches millisecond representation
  assert.equal(
    UPLOAD_SERVER_MAX_DURATION_MS,
    UPLOAD_SERVER_MAX_DURATION_SECONDS * 1000,
    "UPLOAD_SERVER_MAX_DURATION_MS must equal UPLOAD_SERVER_MAX_DURATION_SECONDS * 1000",
  );

  // 2. Server route config exports literal numeric maxDuration matching UPLOAD_SERVER_MAX_DURATION_SECONDS
  const routeSource = await readFile("src/app/api/documents/route.ts", "utf8");
  const match = routeSource.match(/export const maxDuration\s*=\s*(\d+);/);
  assert.ok(match, "src/app/api/documents/route.ts must export numeric literal maxDuration");
  const routeMaxDuration = Number(match[1]);
  assert.equal(
    routeMaxDuration,
    UPLOAD_SERVER_MAX_DURATION_SECONDS,
    `src/app/api/documents/route.ts maxDuration (${routeMaxDuration}s) must match UPLOAD_SERVER_MAX_DURATION_SECONDS (${UPLOAD_SERVER_MAX_DURATION_SECONDS}s)`,
  );

  // 3. Client processing timeout must be strictly greater than server maxDuration
  assert.ok(
    UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS > UPLOAD_SERVER_MAX_DURATION_MS,
    `Client processing timeout (${UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS}ms) must strictly exceed server maxDuration (${UPLOAD_SERVER_MAX_DURATION_MS}ms)`,
  );

  // 4. Server attempt lease must be strictly greater than client processing timeout
  assert.ok(
    UPLOAD_LEASE_DURATION_MS > UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS,
    `Lease duration (${UPLOAD_LEASE_DURATION_MS}ms) must strictly exceed client processing timeout (${UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS}ms)`,
  );

  // 5. Server attempt lease must be strictly greater than server maxDuration
  assert.ok(
    UPLOAD_LEASE_DURATION_MS > UPLOAD_SERVER_MAX_DURATION_MS,
    `Lease duration (${UPLOAD_LEASE_DURATION_MS}ms) must strictly exceed server maxDuration (${UPLOAD_SERVER_MAX_DURATION_MS}ms)`,
  );

  // 6. Minimum safety buffer checks: client timeout must give at least 10s buffer past server timeout
  const clientBufferMs = UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS - UPLOAD_SERVER_MAX_DURATION_MS;
  assert.ok(
    clientBufferMs >= 10_000,
    `Client processing timeout must have at least a 10s safety buffer beyond server timeout (actual: ${clientBufferMs}ms)`,
  );

  // 7. Lease must provide at least a 30s buffer past client timeout
  const leaseBufferMs = UPLOAD_LEASE_DURATION_MS - UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS;
  assert.ok(
    leaseBufferMs >= 30_000,
    `Lease duration must have at least a 30s safety buffer beyond client timeout (actual: ${leaseBufferMs}ms)`,
  );

  // 8. UploadQueue defaults to UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS
  const queue = new UploadQueue();
  const queueTimeout = (queue as unknown as { processingTimeoutMs: number }).processingTimeoutMs;
  assert.equal(
    queueTimeout,
    UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS,
    "UploadQueue must default to UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS",
  );
});

test("simulated violation: raising server maxDuration without raising client timeout or lease fails invariant", () => {
  function assertTimingHierarchy(serverMaxDurationSec: number, clientTimeoutMs: number, leaseMs: number) {
    const serverMs = serverMaxDurationSec * 1000;
    if (clientTimeoutMs <= serverMs) {
      throw new Error(`Timing invariant violated: client processing timeout (${clientTimeoutMs}ms) must be strictly greater than server maxDuration (${serverMs}ms)`);
    }
    if (leaseMs <= serverMs) {
      throw new Error(`Timing invariant violated: attempt lease (${leaseMs}ms) must be strictly greater than server maxDuration (${serverMs}ms)`);
    }
    if (leaseMs <= clientTimeoutMs) {
      throw new Error(`Timing invariant violated: attempt lease (${leaseMs}ms) must be strictly greater than client processing timeout (${clientTimeoutMs}ms)`);
    }
    return true;
  }

  // Current single-source-of-truth values pass
  assert.equal(
    assertTimingHierarchy(UPLOAD_SERVER_MAX_DURATION_SECONDS, UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS, UPLOAD_LEASE_DURATION_MS),
    true,
  );

  // Raising server maxDuration to 80s while client timeout is 75s fails
  assert.throws(
    () => assertTimingHierarchy(80, UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS, UPLOAD_LEASE_DURATION_MS),
    /client processing timeout \(75000ms\) must be strictly greater than server maxDuration \(80000ms\)/,
  );

  // Raising server maxDuration to 130s while lease is 120s fails
  assert.throws(
    () => assertTimingHierarchy(130, 140_000, UPLOAD_LEASE_DURATION_MS),
    /attempt lease \(120000ms\) must be strictly greater than server maxDuration \(130000ms\)/,
  );

  // Setting lease shorter than client timeout fails
  assert.throws(
    () => assertTimingHierarchy(60, 75_000, 70_000),
    /attempt lease \(70000ms\) must be strictly greater than client processing timeout \(75000ms\)/,
  );
});
