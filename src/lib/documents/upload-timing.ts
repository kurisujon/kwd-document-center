/**
 * Single source of truth for upload lifecycle timing and timeouts across
 * the client upload queue, server route handler, and database attempt leasing.
 *
 * Invariant Hierarchy:
 *   UPLOAD_LEASE_DURATION_MS > UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS > UPLOAD_SERVER_MAX_DURATION_MS
 *
 * This ensures:
 * 1. The client queue never prematurely times out or displays a failure message
 *    while the serverless function is actively executing within its maxDuration window.
 * 2. An attempt lease held by a worker never expires or gets reclaimed while either
 *    the original serverless invocation or the client connection is still in flight.
 */

/**
 * Serverless function maximum execution ceiling declared on the upload route.
 * In Next.js App Router route handlers, maxDuration is configured in seconds.
 * 60 seconds is well within Vercel's 300-second Hobby ceiling and 800-second Pro ceiling.
 */
export const UPLOAD_SERVER_MAX_DURATION_SECONDS = 60;
export const UPLOAD_SERVER_MAX_DURATION_MS = UPLOAD_SERVER_MAX_DURATION_SECONDS * 1000;

/**
 * Client-side processing timeout for the upload queue (in milliseconds).
 * Triggered if bytes have reached 100% (onProcessing) but no completion or error
 * response is received. Must be strictly greater than UPLOAD_SERVER_MAX_DURATION_MS
 * to afford a 15-second buffer for network roundtrips and server-side finalization.
 */
export const UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS = 75_000; // 75 seconds

/**
 * Database lease duration for an UPLOADING attempt (in milliseconds).
 * Fencing token lease held by the active worker while reserving Drive ID
 * and uploading media. Must be strictly greater than UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS
 * and UPLOAD_SERVER_MAX_DURATION_MS so a crashed or stalled worker cannot be
 * reclaimed while still executing.
 */
export const UPLOAD_LEASE_DURATION_MS = 120_000; // 120 seconds (2 minutes)
