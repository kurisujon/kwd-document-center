import assert from "node:assert/strict";
import test from "node:test";
import {
  UploadQueue,
} from "../src/lib/documents/upload-queue.ts";
import { UploadTransportError, type ActiveUploadHandle, type UploadTransportOptions } from "../src/lib/documents/upload-transport.ts";
import type { BatchUploadMetadata } from "../src/lib/documents/batch-upload-types.ts";
import type { DocumentRecord } from "../src/lib/documents/types.ts";

const sampleMetadata: BatchUploadMetadata = {
  document_type: "MEMORANDUM",
  filing_year: 2026,
  filing_subcategory: "",
  document_number: "MEMO-001",
  document_date: "2026-10-30",
  subject: "Test Subject",
  persons_involved: "Staff",
};

function createMockFile(name: string, size = 1000): File {
  return new File(["x".repeat(size)], name, { type: "application/pdf" });
}

test("upload-queue: enforces max concurrency of 3 and automatically starts next queued item", async () => {
  const activeTransports: Array<{
    options: UploadTransportOptions;
    resolve: (res: { document: DocumentRecord; reused: boolean }) => void;
  }> = [];

  const mockTransport = (options: UploadTransportOptions): ActiveUploadHandle => {
    let resolvePromise: (res: { document: DocumentRecord; reused: boolean }) => void;
    const promise = new Promise<{ document: DocumentRecord; reused: boolean }>((res) => {
      resolvePromise = res;
    });
    activeTransports.push({ options, resolve: resolvePromise! });
    return {
      abort: () => {},
      promise,
    };
  };

  const queue = new UploadQueue({ concurrency: 3, transport: mockTransport });

  // Enqueue 5 items
  queue.enqueue([
    { file: createMockFile("file1.pdf"), metadata: sampleMetadata },
    { file: createMockFile("file2.pdf"), metadata: sampleMetadata },
    { file: createMockFile("file3.pdf"), metadata: sampleMetadata },
    { file: createMockFile("file4.pdf"), metadata: sampleMetadata },
    { file: createMockFile("file5.pdf"), metadata: sampleMetadata },
  ]);

  const snap1 = queue.getSnapshot();
  assert.equal(snap1.activeCount, 3);
  assert.equal(snap1.queuedCount, 2);
  assert.equal(activeTransports.length, 3);

  // Complete file1
  activeTransports[0].resolve({
    document: { document_id: "doc-1", document_number: "1" } as DocumentRecord,
    reused: false,
  });

  // Allow microtasks to settle
  await new Promise((r) => setTimeout(r, 10));

  const snap2 = queue.getSnapshot();
  assert.equal(snap2.completedCount, 1);
  assert.equal(snap2.activeCount, 3); // file4 should have started!
  assert.equal(snap2.queuedCount, 1);
  assert.equal(activeTransports.length, 4);

  // Complete file2, file3, file4, file5
  for (let i = 1; i < activeTransports.length; i++) {
    activeTransports[i].resolve({
      document: { document_id: `doc-${i + 1}`, document_number: `${i + 1}` } as DocumentRecord,
      reused: false,
    });
  }

  await new Promise((r) => setTimeout(r, 10));

  // Now file 5 should have started and can be resolved
  if (activeTransports.length > 4) {
    activeTransports[4].resolve({
      document: { document_id: "doc-5", document_number: "5" } as DocumentRecord,
      reused: false,
    });
  }

  await new Promise((r) => setTimeout(r, 10));

  const snapFinal = queue.getSnapshot();
  assert.equal(snapFinal.completedCount, 5);
  assert.equal(snapFinal.activeCount, 0);
  assert.equal(snapFinal.isIdle, true);
  queue.destroy();
});

test("upload-queue: cancel leaves no partial document or Drive file (aborts in-flight request, yields no document)", async () => {
  let transportAborted = false;
  let transportStarted = false;

  const mockTransport = (): ActiveUploadHandle => {
    transportStarted = true;
    return {
      abort: () => {
        transportAborted = true;
      },
      promise: new Promise((_resolve, reject) => {
        // Will reject with ABORTED when abort is called
        setTimeout(() => {
          if (transportAborted) {
            reject(new UploadTransportError("Upload was cancelled.", 0, "ABORTED"));
          }
        }, 5);
      }),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: mockTransport });

  queue.enqueue([
    { localId: "item-1", file: createMockFile("cancel-me.pdf"), metadata: sampleMetadata },
    { localId: "item-2", file: createMockFile("never-starts.pdf"), metadata: sampleMetadata },
  ]);

  assert.equal(transportStarted, true);
  const snap1 = queue.getSnapshot();
  assert.equal(snap1.items[0].state, "UPLOADING");
  assert.equal(snap1.items[1].state, "QUEUED");

  // Cancel item-1 (in-flight) and item-2 (queued)
  queue.cancelItem("item-1");
  queue.cancelItem("item-2");

  assert.equal(transportAborted, true);

  await new Promise((r) => setTimeout(r, 20));

  const snap2 = queue.getSnapshot();
  assert.equal(snap2.items[0].state, "CANCELLED");
  assert.equal(snap2.items[1].state, "CANCELLED");
  assert.equal(snap2.items[0].documentId, undefined, "Cancelled in-flight upload must have no documentId");
  assert.equal(snap2.items[1].documentId, undefined, "Cancelled queued upload must have no documentId");
  assert.equal(snap2.completedCount, 0, "Cancelled uploads must not be recorded as completed");
  assert.equal(snap2.isIdle, true);
  queue.destroy();
});

test("upload-queue: retry after a dropped connection creates no duplicate (reuses the exact same idempotency key)", async () => {
  const capturedIdempotencyKeys: string[] = [];
  let attemptNumber = 0;

  const mockTransport = (options: UploadTransportOptions): ActiveUploadHandle => {
    attemptNumber += 1;
    capturedIdempotencyKeys.push(options.idempotencyKey);

    return {
      abort: () => {},
      promise: new Promise<{ document: DocumentRecord; reused: boolean }>((resolve, reject) => {
        if (attemptNumber === 1) {
          // Drop connection on first attempt
          reject(new UploadTransportError("Network connection was interrupted. Please retry.", 0, "NETWORK_ERROR"));
        } else {
          // Succeed on retry with reused document
          resolve({
            document: { document_id: "doc-idempotent-100", document_number: "MEMO-001" } as DocumentRecord,
            reused: true,
          });
        }
      }),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: mockTransport });

  queue.enqueue([
    { localId: "item-retry", file: createMockFile("retry-doc.pdf"), metadata: sampleMetadata },
  ]);

  await new Promise((r) => setTimeout(r, 10));

  const snapFailed = queue.getSnapshot();
  assert.equal(snapFailed.items[0].state, "FAILED");
  assert.equal(snapFailed.items[0].error, "Network connection was interrupted. Please retry.");
  const originalKey = snapFailed.items[0].idempotencyKey;
  assert.ok(originalKey);

  // Trigger retry
  queue.retryItem("item-retry");

  await new Promise((r) => setTimeout(r, 10));

  const snapDone = queue.getSnapshot();
  assert.equal(snapDone.items[0].state, "DONE");
  assert.equal(snapDone.items[0].documentId, "doc-idempotent-100");

  // Verify that both attempts used the EXACT SAME idempotency key
  assert.equal(capturedIdempotencyKeys.length, 2);
  assert.equal(capturedIdempotencyKeys[0], originalKey);
  assert.equal(capturedIdempotencyKeys[1], originalKey, "Retried upload MUST reuse original idempotency key to prevent duplicates");
  queue.destroy();
});

test("upload-queue: expired Google token classifies isGoogleAuthExpired and shows admin guidance without leaked secrets", async () => {
  const mockTransport = (): ActiveUploadHandle => {
    return {
      abort: () => {},
      promise: Promise.reject(
        new UploadTransportError(
          "Google Drive authorization has expired. Please re-authorize Google Drive in Admin settings.",
          502,
          "DRIVE_AUTH_EXPIRED",
          "/admin/drive-setup/authorize",
        ),
      ),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: mockTransport });

  queue.enqueue([
    { localId: "item-expired", file: createMockFile("expired-token.pdf"), metadata: sampleMetadata },
  ]);

  await new Promise((r) => setTimeout(r, 10));

  const snap = queue.getSnapshot();
  const item = snap.items[0]!;
  assert.equal(item.state, "FAILED");
  assert.equal(item.isGoogleAuthExpired, true);
  assert.equal(item.errorCode, "DRIVE_AUTH_EXPIRED");
  assert.equal(item.actionUrl, "/admin/drive-setup/authorize");
  assert.match(item.error ?? "", /re-authorize.*Admin/i);

  // Verify no secrets or sensitive tokens are present in item state or error string
  assert.doesNotMatch(item.error ?? "", /token|secret|client_id|refresh/i);
  queue.destroy();
});

test("upload-queue: cancel is disabled during PROCESSING and cancelAll preserves PROCESSING items", async () => {
  const triggerProcessingMap = new Map<string, () => void>();
  const finishUploadMap = new Map<string, (res: UploadTransportResult) => void>();

  const processingTransport = (options: UploadTransportOptions): ActiveUploadHandle => {
    return {
      abort: () => {},
      promise: new Promise<UploadTransportResult>((resolve) => {
        triggerProcessingMap.set(options.file.name, () => {
          options.onProcessing?.();
        });
        finishUploadMap.set(options.file.name, (res) => resolve(res));
      }),
    };
  };

  const queue = new UploadQueue({ concurrency: 2, transport: processingTransport });

  queue.enqueue([
    { localId: "item-p1", file: createMockFile("file-p1.pdf"), metadata: sampleMetadata },
    { localId: "item-p2", file: createMockFile("file-p2.pdf"), metadata: sampleMetadata },
    { localId: "item-queued", file: createMockFile("file-q.pdf"), metadata: sampleMetadata },
  ]);

  // item-p1 and item-p2 start uploading
  assert.equal(queue.getSnapshot().items[0]!.state, "UPLOADING");
  assert.equal(queue.getSnapshot().items[1]!.state, "UPLOADING");
  assert.equal(queue.getSnapshot().items[2]!.state, "QUEUED");

  // Advance item-p1 to PROCESSING
  triggerProcessingMap.get("file-p1.pdf")!();
  assert.equal(queue.getSnapshot().items[0]!.state, "PROCESSING");

  // Attempting to cancel item-p1 directly while in PROCESSING has no effect
  queue.cancelItem("item-p1");
  assert.equal(queue.getSnapshot().items[0]!.state, "PROCESSING", "Item in PROCESSING must not be cancelled");

  // Executing cancelAll() cancels queued and uploading items, but preserves PROCESSING items
  queue.cancelAll();
  assert.equal(queue.getSnapshot().items[0]!.state, "PROCESSING", "PROCESSING item must survive cancelAll");
  assert.equal(queue.getSnapshot().items[1]!.state, "CANCELLED", "UPLOADING item is cancelled by cancelAll");
  assert.equal(queue.getSnapshot().items[2]!.state, "CANCELLED", "QUEUED item is cancelled by cancelAll");

  // item-p1 completes successfully
  finishUploadMap.get("file-p1.pdf")!({ document: { document_id: "doc-p1-id" } });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(queue.getSnapshot().items[0]!.state, "DONE");
  assert.equal(queue.getSnapshot().items[0]!.documentId, "doc-p1-id");
  queue.destroy();
});

test("upload-queue: 401 session expiry stops the queue and does not auto-retry", async () => {
  let transportCalls = 0;
  const mock401Transport = (): ActiveUploadHandle => {
    transportCalls++;
    return {
      abort: () => {},
      promise: Promise.reject(
        new UploadTransportError("Your session has expired. Sign in is required.", 401, "UNAUTHORIZED", false, true),
      ),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: mock401Transport });

  queue.enqueue([
    { localId: "item-1", file: createMockFile("item1.pdf"), metadata: sampleMetadata },
    { localId: "item-2", file: createMockFile("item2.pdf"), metadata: sampleMetadata },
  ]);

  await new Promise((r) => setTimeout(r, 10));

  const snap = queue.getSnapshot();
  assert.equal(snap.isPaused, true, "Queue must be paused on 401");
  assert.equal(snap.isAuthExpired, true, "Auth expired state must be flagged");
  assert.equal(snap.items[0]!.state, "FAILED");
  assert.equal(snap.items[0]!.errorCode, "UNAUTHORIZED");
  assert.equal(snap.items[0]!.isAuthExpired, true);

  // Item 2 must remain QUEUED and not executed
  assert.equal(snap.items[1]!.state, "QUEUED");
  assert.equal(transportCalls, 1, "Queue must not start subsequent items after 401");

  queue.destroy();
});
