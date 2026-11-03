import assert from "node:assert/strict";
import test from "node:test";
import {
  startDocumentUpload,
  UploadTransportError,
  type UploadProgress,
} from "../src/lib/documents/upload-transport.ts";
import type { BatchUploadMetadata } from "../src/lib/documents/batch-upload-types.ts";

// Mock XMLHttpRequest implementation for Node environment
class MockXMLHttpRequest {
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };
  status = 200;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  openedUrl = "";
  openedMethod = "";
  sentData: FormData | null = null;
  aborted = false;

  open(method: string, url: string) {
    this.openedMethod = method;
    this.openedUrl = url;
  }

  send(data: FormData) {
    this.sentData = data;
    MockXMLHttpRequest.lastInstance = this;
  }

  abort() {
    this.aborted = true;
    if (this.onabort) this.onabort();
  }

  static lastInstance: MockXMLHttpRequest | null = null;
}

// Attach mock XMLHttpRequest to globalThis
const originalXHR = (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = MockXMLHttpRequest;

const mockMetadata: BatchUploadMetadata = {
  document_type: "MEMORANDUM",
  filing_year: 2026,
  filing_subcategory: "",
  document_number: "MEMO-101",
  document_date: "2026-10-30",
  subject: "Quarterly report",
  persons_involved: "Staff",
};

test("upload-transport: reports real byte progress and calls onProcessing at 100%", async () => {
  const file = new File(["sample content here"], "memo.pdf", { type: "application/pdf" });
  const progressSnapshots: UploadProgress[] = [];
  let processingCalled = false;

  const handle = startDocumentUpload({
    file,
    metadata: mockMetadata,
    idempotencyKey: "test-idempotency-key-1",
    onProgress: (p) => progressSnapshots.push(p),
    onProcessing: () => {
      processingCalled = true;
    },
  });

  const xhr = MockXMLHttpRequest.lastInstance;
  assert.ok(xhr);
  assert.equal(xhr.openedMethod, "POST");
  assert.equal(xhr.openedUrl, "/api/documents");

  // Simulate progress events
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 500, total: 1000 });
  assert.equal(progressSnapshots.length, 1);
  assert.equal(progressSnapshots[0].percent, 50);
  assert.equal(processingCalled, false);

  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });
  assert.equal(progressSnapshots.length, 2);
  assert.equal(progressSnapshots[1].percent, 100);
  assert.equal(processingCalled, true);

  // Complete server processing
  xhr.status = 201;
  xhr.responseText = JSON.stringify({
    document: { document_id: "doc-12345", document_number: "MEMO-101" },
    reused: false,
  });
  xhr.onload?.();

  const result = await handle.promise;
  assert.equal(result.document.document_id, "doc-12345");
  assert.equal(result.reused, false);
});

test("upload-transport: aborting request cancels XHR and rejects with ABORTED code", async () => {
  const file = new File(["sample"], "memo.pdf", { type: "application/pdf" });

  const handle = startDocumentUpload({
    file,
    metadata: mockMetadata,
    idempotencyKey: "test-idempotency-key-2",
  });

  const xhr = MockXMLHttpRequest.lastInstance;
  assert.ok(xhr);

  handle.abort();
  assert.equal(xhr.aborted, true);

  await assert.rejects(
    handle.promise,
    (err: unknown) => {
      assert.ok(err instanceof UploadTransportError);
      assert.equal(err.code, "ABORTED");
      assert.equal(err.isAborted, true);
      return true;
    },
  );
});

test("upload-transport: network failure triggers NETWORK_ERROR with retry guidance", async () => {
  const file = new File(["sample"], "memo.pdf", { type: "application/pdf" });

  const handle = startDocumentUpload({
    file,
    metadata: mockMetadata,
    idempotencyKey: "test-idempotency-key-3",
  });

  const xhr = MockXMLHttpRequest.lastInstance;
  assert.ok(xhr);

  xhr.onerror?.();

  await assert.rejects(
    handle.promise,
    (err: unknown) => {
      assert.ok(err instanceof UploadTransportError);
      assert.equal(err.code, "NETWORK_ERROR");
      assert.equal(err.isNetworkError, true);
      return true;
    },
  );
});

test("upload-transport: server error parses error code and message safely", async () => {
  const file = new File(["sample"], "memo.pdf", { type: "application/pdf" });

  const handle = startDocumentUpload({
    file,
    metadata: mockMetadata,
    idempotencyKey: "test-idempotency-key-4",
  });

  const xhr = MockXMLHttpRequest.lastInstance;
  assert.ok(xhr);

  xhr.status = 502;
  xhr.responseText = JSON.stringify({
    error: {
      code: "DRIVE_ERROR",
      message: "Google Drive storage connection has expired. Please contact an administrator.",
    },
  });
  xhr.onload?.();

  await assert.rejects(
    handle.promise,
    (err: unknown) => {
      assert.ok(err instanceof UploadTransportError);
      assert.equal(err.status, 502);
      assert.equal(err.code, "DRIVE_ERROR");
      assert.equal(err.isGoogleAuthExpired, true);
      assert.match(err.message, /contact an administrator/);
      return true;
    },
  );
});

test("upload-transport: lost connection during saving informs staff to retry to confirm", async () => {
  const file = new File(["sample"], "memo.pdf", { type: "application/pdf" });

  const handle = startDocumentUpload({
    file,
    metadata: mockMetadata,
    idempotencyKey: "test-idempotency-key-5",
  });

  const xhr = MockXMLHttpRequest.lastInstance;
  assert.ok(xhr);

  // Trigger 100% upload bytes sent -> enters saving phase
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });

  // Network drops while waiting for Google Drive / DB response
  xhr.onerror?.();

  await assert.rejects(
    handle.promise,
    (err: unknown) => {
      assert.ok(err instanceof UploadTransportError);
      assert.equal(err.code, "NETWORK_ERROR");
      assert.match(err.message, /Connection was lost while saving\. Please retry to confirm/);
      return true;
    },
  );
});

test("upload-transport: timeout during saving rejects with PROCESSING_TIMEOUT and safe retry guidance", async () => {
  const file = new File(["sample"], "memo.pdf", { type: "application/pdf" });

  const handle = startDocumentUpload({
    file,
    metadata: mockMetadata,
    idempotencyKey: "test-idempotency-key-6",
  });

  const xhr = MockXMLHttpRequest.lastInstance;
  assert.ok(xhr);

  // Trigger 100% upload bytes sent
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });

  // Client timeout fires
  xhr.ontimeout?.();

  await assert.rejects(
    handle.promise,
    (err: unknown) => {
      assert.ok(err instanceof UploadTransportError);
      assert.equal(err.code, "PROCESSING_TIMEOUT");
      assert.equal(err.message, "Taking longer than expected. Retry is safe.");
      return true;
    },
  );
});

// Restore original XHR if any
test.after(() => {
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = originalXHR;
});
