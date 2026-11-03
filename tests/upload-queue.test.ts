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

function createMockDocument(document_id: string): DocumentRecord {
  return {
    document_id,
    document_number: "MEMO-001",
    document_type: "MEMORANDUM",
    filing_year: 2026,
    filing_subcategory: null,
    document_date: "2026-10-30",
    subject: "Test Subject",
    persons_involved: "Staff",
    drive_file_id: "drive-123",
    drive_folder_id: "folder-123",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    created_by: "user-1",
    file_name: "test.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 1000,
    file_sha256: null,
  };
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
          "/api/admin/drive-setup/authorize",
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
  assert.equal(item.actionUrl, "/api/admin/drive-setup/authorize");
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

test("upload-queue: clear() does not abort items in PROCESSING and leaves them to finish", async () => {
  let triggerProcessing: () => void = () => {};
  let finishUpload: (res: { document: DocumentRecord; reused: boolean }) => void = () => {};
  let abortCalledForP1 = false;
  let abortCalledForP2 = false;

  const transport = (options: UploadTransportOptions): ActiveUploadHandle => {
    if (options.file.name === "file-proc.pdf") {
      return {
        abort: () => {
          abortCalledForP1 = true;
        },
        promise: new Promise<{ document: DocumentRecord; reused: boolean }>((resolve) => {
          triggerProcessing = () => {
            options.onProcessing?.();
          };
          finishUpload = (res) => resolve(res);
        }),
      };
    }
    return {
      abort: () => {
        abortCalledForP2 = true;
      },
      promise: new Promise<{ document: DocumentRecord; reused: boolean }>(() => {}),
    };
  };

  const queue = new UploadQueue({ concurrency: 2, transport });

  queue.enqueue([
    { localId: "item-proc", file: createMockFile("file-proc.pdf"), metadata: sampleMetadata },
    { localId: "item-uploading", file: createMockFile("file-uploading.pdf"), metadata: sampleMetadata },
    { localId: "item-queued", file: createMockFile("file-queued.pdf"), metadata: sampleMetadata },
  ]);

  // Transition item-proc to PROCESSING
  triggerProcessing();
  assert.equal(queue.getSnapshot().items.find((i) => i.localId === "item-proc")?.state, "PROCESSING");

  // Call clear()
  queue.clear();

  // UPLOADING item was aborted and removed
  assert.equal(abortCalledForP2, true, "UPLOADING item must have abort invoked on clear");
  // PROCESSING item was NOT aborted and NOT discarded
  assert.equal(abortCalledForP1, false, "PROCESSING item must NOT have abort invoked on clear");

  const snapAfterClear = queue.getSnapshot();
  const processingItem = snapAfterClear.items.find((i) => i.localId === "item-proc");
  assert.ok(processingItem, "PROCESSING item must remain in queue after clear");
  assert.equal(processingItem.state, "PROCESSING");
  assert.equal(snapAfterClear.items.length, 1, "Only PROCESSING item should remain");

  // Allow item-proc to finish
  finishUpload({ document: createMockDocument("doc-proc-id"), reused: false });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(queue.getSnapshot().items[0]?.state, "DONE");
  assert.equal(queue.getSnapshot().items[0]?.documentId, "doc-proc-id");
  queue.destroy();
});

test("upload-queue: processing timeout transitions item to FAILED with safe retry guidance", async () => {
  let triggerProcessing: () => void = () => {};

  const timeoutTransport = (options: UploadTransportOptions): ActiveUploadHandle => {
    return {
      abort: () => {},
      promise: new Promise<{ document: DocumentRecord; reused: boolean }>((_resolve) => {
        triggerProcessing = () => {
          options.onProcessing?.();
        };
      }),
    };
  };

  const queue = new UploadQueue({
    concurrency: 1,
    processingTimeoutMs: 30, // 30ms timeout for test
    transport: timeoutTransport,
  });

  queue.enqueue([
    { localId: "item-slow", file: createMockFile("slow-doc.pdf"), metadata: sampleMetadata },
  ]);

  triggerProcessing();
  assert.equal(queue.getSnapshot().items[0]?.state, "PROCESSING");

  // Wait for processing timeout to fire
  await new Promise((r) => setTimeout(r, 50));

  const snap = queue.getSnapshot();
  const item = snap.items[0]!;
  assert.equal(item.state, "FAILED");
  assert.equal(item.errorCode, "PROCESSING_TIMEOUT");
  assert.equal(item.error, "Taking longer than expected. Retry is safe.");

  queue.destroy();
});

test("upload-queue: queue isolates items per user and drops processing items finishing after user switch or sign out", async () => {
  let triggerProcessing: () => void = () => {};
  let finishUpload: (res: { document: DocumentRecord; reused: boolean }) => void = () => {};

  const transport = (options: UploadTransportOptions): ActiveUploadHandle => {
    return {
      abort: () => {},
      promise: new Promise<{ document: DocumentRecord; reused: boolean }>((resolve) => {
        triggerProcessing = () => {
          options.onProcessing?.();
        };
        finishUpload = (res) => resolve(res);
      }),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport });

  // User A logs in and enqueues a confidential document
  queue.setActiveUser("user-a-uuid");
  queue.enqueue([
    { localId: "user-a-doc", file: createMockFile("confidential-a.pdf"), metadata: sampleMetadata },
  ]);

  triggerProcessing();
  assert.equal(queue.getSnapshot().items[0]?.file.name, "confidential-a.pdf");
  assert.equal(queue.getSnapshot().items[0]?.state, "PROCESSING");

  // User A signs out: active user set to null
  queue.setActiveUser(null);
  // While signed out, the item is retained only in internal memory so it completes on server
  assert.equal(queue.getSnapshot().items.length, 1);

  // User B logs in
  queue.setActiveUser("user-b-uuid");
  // User B's queue snapshot must NOT contain User A's confidential file!
  assert.equal(queue.getSnapshot().items.length, 0, "User B must never see User A's files");

  // Now User A's background upload completes in Google Drive
  finishUpload({ document: createMockDocument("doc-a-id"), reused: false });
  await new Promise((r) => setTimeout(r, 10));

  // Verify User A's completed item was dropped and NOT displayed in User B's queue
  const snapAfterFinish = queue.getSnapshot();
  assert.equal(snapAfterFinish.items.length, 0, "Finished item for prior user must be dropped, not shown");

  queue.destroy();
});

test("upload-queue: 409 UPLOAD_IN_PROGRESS shows still-saving status and allows check-status retry", async () => {
  let attemptCount = 0;
  const inProgressTransport = (_options: UploadTransportOptions): ActiveUploadHandle => {
    attemptCount += 1;
    if (attemptCount === 1) {
      return {
        abort: () => {},
        promise: Promise.reject(
          new UploadTransportError("This upload is already being processed. Please retry shortly.", 409, "UPLOAD_IN_PROGRESS"),
        ),
      };
    }
    return {
      abort: () => {},
      promise: Promise.resolve({
        document: createMockDocument("doc-retry-complete"),
        reused: true,
      }),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: inProgressTransport });
  queue.enqueue([
    { localId: "item-conflict", file: createMockFile("concurrent.pdf"), metadata: sampleMetadata },
  ]);

  await new Promise((r) => setTimeout(r, 10));

  // Item should be in FAILED state with UPLOAD_IN_PROGRESS code and honest still-saving message
  const snap1 = queue.getSnapshot();
  const item = snap1.items[0]!;
  assert.equal(item.state, "FAILED");
  assert.equal(item.errorCode, "UPLOAD_IN_PROGRESS");
  assert.equal(item.error, "Upload is still saving on the server. Retry shortly to check status.");

  // Retry / Check status
  queue.retryItem("item-conflict");
  await new Promise((r) => setTimeout(r, 10));

  // Should succeed and transition to DONE
  const snap2 = queue.getSnapshot();
  assert.equal(snap2.items[0]!.state, "DONE");
  assert.equal(snap2.items[0]!.documentId, "doc-retry-complete");

  queue.destroy();
});

test("upload-queue: momentary null user during hydration/refresh keeps queue intact when same user returns", async () => {
  let resolvePromise = () => {};
  const manualTransport = (_options: UploadTransportOptions): ActiveUploadHandle => {
    return {
      abort: () => {},
      promise: new Promise<{ document: DocumentRecord; reused: boolean }>((resolve) => {
        resolvePromise = () => resolve({ document: createMockDocument("doc-1"), reused: false });
      }),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: manualTransport });

  // User A logs in and has queued/uploading items
  queue.setActiveUser("user-hydration-test");
  queue.enqueue([
    { localId: "doc-1", file: createMockFile("file-1.pdf"), metadata: sampleMetadata },
    { localId: "doc-2", file: createMockFile("file-2.pdf"), metadata: sampleMetadata },
  ]);

  const snapBefore = queue.getSnapshot();
  assert.equal(snapBefore.items.length, 2);
  assert.equal(snapBefore.items[0]?.state, "UPLOADING");
  assert.equal(snapBefore.items[1]?.state, "QUEUED");

  // React re-hydration or session token refresh triggers temporary null user
  queue.setActiveUser(null);

  // Queue must NOT be wiped or dropped
  const snapDuringNull = queue.getSnapshot();
  assert.equal(snapDuringNull.items.length, 2, "Items must not be discarded during momentary null user state");
  assert.equal(snapDuringNull.items[0]?.localId, "doc-1");
  assert.equal(snapDuringNull.items[1]?.localId, "doc-2");

  // Same user returns after session refresh completes
  queue.setActiveUser("user-hydration-test");

  const snapAfterReturn = queue.getSnapshot();
  assert.equal(snapAfterReturn.items.length, 2, "Queue must remain completely intact when same user returns");
  assert.equal(snapAfterReturn.items[0]?.state, "UPLOADING");
  assert.equal(snapAfterReturn.items[1]?.state, "QUEUED");

  // Resolve pending promise and cleanup
  resolvePromise();
  queue.destroy();
});

test("upload-queue: repeated 409 UPLOAD_IN_PROGRESS beyond limit informs staff to contact administrator", async () => {
  const recurring409Transport = (_options: UploadTransportOptions): ActiveUploadHandle => {
    return {
      abort: () => {},
      promise: Promise.reject(
        new UploadTransportError("This upload is already being processed. Please retry shortly.", 409, "UPLOAD_IN_PROGRESS"),
      ),
    };
  };

  const queue = new UploadQueue({ concurrency: 1, transport: recurring409Transport });
  queue.enqueue([
    { localId: "item-stuck", file: createMockFile("stuck.pdf"), metadata: sampleMetadata },
  ]);

  // Initial attempt: retryCount 0
  await new Promise((r) => setTimeout(r, 10));
  let item = queue.getSnapshot().items[0]!;
  assert.equal(item.state, "FAILED");
  assert.equal(item.errorCode, "UPLOAD_IN_PROGRESS");
  assert.equal(item.error, "Upload is still saving on the server. Retry shortly to check status.");

  // Retry 1 (retryCount becomes 1)
  queue.retryItem("item-stuck");
  await new Promise((r) => setTimeout(r, 10));
  item = queue.getSnapshot().items[0]!;
  assert.equal(item.error, "Upload is still saving on the server. Retry shortly to check status.");

  // Retry 2 (retryCount becomes 2)
  queue.retryItem("item-stuck");
  await new Promise((r) => setTimeout(r, 10));
  item = queue.getSnapshot().items[0]!;
  assert.equal(item.error, "Upload is still saving on the server. Retry shortly to check status.");

  // Retry 3 (retryCount becomes 3 -> reaches stale limit)
  queue.retryItem("item-stuck");
  await new Promise((r) => setTimeout(r, 10));
  item = queue.getSnapshot().items[0]!;
  assert.equal(item.error, "Upload is taking longer than expected. Please contact an administrator.");

  queue.destroy();
});
