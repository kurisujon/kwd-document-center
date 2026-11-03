/**
 * Client-Side In-Memory Upload Queue.
 *
 * Runs up to 3 concurrent uploads, reports accurate byte-level progress,
 * exposes explicit PROCESSING state, supports cancel/retry with idempotent
 * key preservation, and persists across route navigation in the client.
 */

import {
  startDocumentUpload,
  UploadTransportError,
  type ActiveUploadHandle,
  type UploadProgress,
} from "./upload-transport";
import type { BatchUploadMetadata } from "./batch-upload-types";
import { batchUploadConcurrency } from "./batch-upload-types";
import { UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS } from "./upload-timing";

export type UploadQueueItemState =
  | "QUEUED"
  | "UPLOADING"
  | "PROCESSING"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export interface UploadQueueItem {
  localId: string;
  file: File;
  metadata: BatchUploadMetadata;
  idempotencyKey: string;
  targetFolderId?: string;
  sourceRelativePath?: string;
  state: UploadQueueItemState;
  bytesSent: number;
  totalBytes: number;
  progressPercent: number; // 0 - 100
  error?: string;
  errorCode?: string;
  actionUrl?: string;
  isAuthExpired?: boolean;
  isGoogleAuthExpired?: boolean;
  documentId?: string;
  documentUrl?: string;
  retryCount: number;
  firstInProgressAt?: number;
  abortHandle?: () => void;
  userId?: string;
}

export interface QueueSnapshot {
  items: UploadQueueItem[];
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  failedCount: number;
  isIdle: boolean;
  hasActive: boolean;
  hasFailures: boolean;
  isAuthExpired: boolean;
  isPaused: boolean;
}

export interface EnqueueItemInput {
  localId?: string;
  file: File;
  metadata: BatchUploadMetadata;
  idempotencyKey?: string;
  targetFolderId?: string;
  sourceRelativePath?: string;
}

export interface UploadQueueConfig {
  concurrency?: number;
  transport?: typeof startDocumentUpload;
  processingTimeoutMs?: number;
}

export class UploadQueue {
  private items: UploadQueueItem[] = [];
  private readonly listeners = new Set<(snapshot: QueueSnapshot) => void>();
  private readonly concurrency: number;
  private readonly transport: typeof startDocumentUpload;
  private readonly processingTimeoutMs: number;
  private currentUserId: string | null = null;
  private lastKnownUserId: string | null = null;
  private isPaused = false;
  private isAuthExpired = false;
  private beforeUnloadRegistered = false;
  private currentSnapshot: QueueSnapshot;

  constructor(config?: UploadQueueConfig) {
    this.concurrency = config?.concurrency ?? batchUploadConcurrency;
    this.transport = config?.transport ?? startDocumentUpload;
    this.processingTimeoutMs = config?.processingTimeoutMs ?? UPLOAD_CLIENT_PROCESSING_TIMEOUT_MS;
    this.currentSnapshot = this.computeSnapshot();

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
      if (this.beforeUnloadRegistered) {
        window.removeEventListener("beforeunload", this.handleBeforeUnload);
        this.beforeUnloadRegistered = false;
      }
    }
    this.listeners.clear();
  }

  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): QueueSnapshot {
    return this.currentSnapshot;
  }

  private computeSnapshot(): QueueSnapshot {
    const items = [...this.items];
    const activeCount = items.filter((i) => i.state === "UPLOADING" || i.state === "PROCESSING").length;
    const queuedCount = items.filter((i) => i.state === "QUEUED").length;
    const completedCount = items.filter((i) => i.state === "DONE").length;
    const failedCount = items.filter((i) => i.state === "FAILED").length;
    const hasActive = activeCount > 0 || queuedCount > 0;

    return {
      items,
      activeCount,
      queuedCount,
      completedCount,
      failedCount,
      isIdle: !hasActive,
      hasActive,
      hasFailures: failedCount > 0,
      isAuthExpired: this.isAuthExpired,
      isPaused: this.isPaused,
    };
  }

  private emitChange(): void {
    this.currentSnapshot = this.computeSnapshot();
    this.updateBeforeUnloadGuard(this.currentSnapshot.hasActive);
    for (const listener of this.listeners) {
      listener(this.currentSnapshot);
    }
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = "Uploads are currently in progress. Leaving this page will cancel active uploads.";
  };

  private updateBeforeUnloadGuard(hasActive: boolean): void {
    if (typeof window === "undefined") return;
    if (hasActive && !this.beforeUnloadRegistered) {
      window.addEventListener("beforeunload", this.handleBeforeUnload);
      this.beforeUnloadRegistered = true;
    } else if (!hasActive && this.beforeUnloadRegistered) {
      window.removeEventListener("beforeunload", this.handleBeforeUnload);
      this.beforeUnloadRegistered = false;
    }
  }

  private handleOnline = (): void => {
    this.isPaused = false;
    this.processQueue();
  };

  private handleOffline = (): void => {
    this.isPaused = true;
  };

  setActiveUser(userId: string | null): void {
    if (this.currentUserId === userId) return;

    if (userId !== null) {
      const isUserSwitch = this.lastKnownUserId !== null && userId !== this.lastKnownUserId;
      this.currentUserId = userId;
      this.lastKnownUserId = userId;

      if (isUserSwitch) {
        // Abort active transfers and cancel pending queues from the prior user
        for (const item of this.items) {
          if (item.state === "QUEUED" || item.state === "UPLOADING") {
            if (item.abortHandle) {
              item.abortHandle();
              item.abortHandle = undefined;
            }
            item.state = "CANCELLED";
          }
        }
      }

      // Filter out items belonging to another user, keep only items for this user
      this.items = this.items.filter((i) => !i.userId || i.userId === userId);
      for (const item of this.items) {
        if (!item.userId) item.userId = userId;
      }
    } else {
      // User is momentarily null (hydration or session refresh)
      this.currentUserId = null;
      // Do NOT wipe items here! Items remain intact in case the same user returns.
    }

    this.emitChange();
  }

  enqueue(inputs: EnqueueItemInput[]): void {
    if (!inputs.length) return;

    for (const input of inputs) {
      const localId = input.localId ?? crypto.randomUUID();
      const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();

      this.items.push({
        localId,
        file: input.file,
        metadata: { ...input.metadata },
        idempotencyKey,
        targetFolderId: input.targetFolderId,
        sourceRelativePath: input.sourceRelativePath,
        userId: this.currentUserId ?? undefined,
        state: "QUEUED",
        bytesSent: 0,
        totalBytes: input.file.size,
        progressPercent: 0,
        retryCount: 0,
      });
    }

    this.emitChange();
    this.processQueue();
  }

  cancelItem(localId: string): void {
    const item = this.items.find((i) => i.localId === localId);
    if (!item) return;

    if (item.state === "QUEUED") {
      item.state = "CANCELLED";
      this.emitChange();
      this.processQueue();
      return;
    }

    // Disallow cancelling during PROCESSING: all bytes have arrived at the server and Drive write is in-flight
    if (item.state === "PROCESSING") {
      return;
    }

    if (item.state === "UPLOADING") {
      if (item.abortHandle) {
        item.abortHandle();
        item.abortHandle = undefined;
      }
      item.state = "CANCELLED";
      this.emitChange();
      this.processQueue();
    }
  }

  cancelAll(): void {
    let changed = false;
    for (const item of this.items) {
      if (item.state === "QUEUED") {
        item.state = "CANCELLED";
        changed = true;
      } else if (item.state === "UPLOADING") {
        if (item.abortHandle) {
          item.abortHandle();
          item.abortHandle = undefined;
        }
        item.state = "CANCELLED";
        changed = true;
      }
      // Items in PROCESSING are not cancelled because bytes have arrived and server is finalizing
    }
    if (changed) {
      this.emitChange();
      this.processQueue();
    }
  }

  retryItem(localId: string): void {
    const item = this.items.find((i) => i.localId === localId);
    if (!item || (item.state !== "FAILED" && item.state !== "CANCELLED")) return;

    this.isPaused = false;
    this.isAuthExpired = false;
    item.state = "QUEUED";
    item.bytesSent = 0;
    item.progressPercent = 0;
    item.error = undefined;
    item.errorCode = undefined;
    item.actionUrl = undefined;
    item.isAuthExpired = undefined;
    item.isGoogleAuthExpired = undefined;
    item.retryCount += 1;
    // Note: item.idempotencyKey is deliberately PRESERVED for idempotency

    this.emitChange();
    this.processQueue();
  }

  retryAllFailed(): void {
    let changed = false;
    this.isPaused = false;
    this.isAuthExpired = false;
    for (const item of this.items) {
      if (item.state === "FAILED" || item.state === "CANCELLED") {
        item.state = "QUEUED";
        item.bytesSent = 0;
        item.progressPercent = 0;
        item.error = undefined;
        item.errorCode = undefined;
        item.actionUrl = undefined;
        item.isAuthExpired = undefined;
        item.isGoogleAuthExpired = undefined;
        item.retryCount += 1;
        changed = true;
      }
    }
    if (changed) {
      this.emitChange();
      this.processQueue();
    }
  }

  dismissCompleted(): void {
    const beforeCount = this.items.length;
    this.items = this.items.filter((i) => i.state !== "DONE" && i.state !== "CANCELLED");
    if (this.items.length !== beforeCount) {
      this.emitChange();
    }
  }

  clear(): void {
    this.cancelAll();
    // Items in PROCESSING are not aborted or cancelled; keep them to finalize safely
    this.items = this.items.filter((i) => i.state === "PROCESSING");
    this.emitChange();
  }

  private processQueue(): void {
    if (this.isPaused) return;

    const activeCount = this.items.filter(
      (i) => i.state === "UPLOADING" || i.state === "PROCESSING",
    ).length;

    const availableSlots = this.concurrency - activeCount;
    if (availableSlots <= 0) return;

    const nextBatch = this.items
      .filter((i) => i.state === "QUEUED")
      .slice(0, availableSlots);

    for (const item of nextBatch) {
      this.startUpload(item);
    }
  }

  private startUpload(item: UploadQueueItem): void {
    item.state = "UPLOADING";
    item.bytesSent = 0;
    item.progressPercent = 0;
    item.error = undefined;

    let processingTimer: ReturnType<typeof setTimeout> | null = null;
    const clearProcessingTimer = () => {
      if (processingTimer) {
        clearTimeout(processingTimer);
        processingTimer = null;
      }
    };

    const handle: ActiveUploadHandle = this.transport({
      file: item.file,
      metadata: item.metadata,
      idempotencyKey: item.idempotencyKey,
      targetFolderId: item.targetFolderId,
      sourceRelativePath: item.sourceRelativePath,
      onProgress: (progress: UploadProgress) => {
        // Only update if still active in UPLOADING state
        if (item.state === "UPLOADING") {
          item.bytesSent = progress.loaded;
          item.totalBytes = progress.total;
          item.progressPercent = progress.percent;
          this.emitChange();
        }
      },
      onProcessing: () => {
        // Byte upload completed (100%), now in Google Drive / registry processing
        if (item.state === "UPLOADING") {
          item.state = "PROCESSING";
          item.bytesSent = item.totalBytes;
          item.progressPercent = 100;
          this.emitChange();

          clearProcessingTimer();
          processingTimer = setTimeout(() => {
            if (item.state === "PROCESSING") {
              item.state = "FAILED";
              item.error = "Taking longer than expected. Retry is safe.";
              item.errorCode = "PROCESSING_TIMEOUT";
              item.abortHandle = undefined;
              this.emitChange();
              this.processQueue();
            }
          }, this.processingTimeoutMs);
        }
      },
    });

    item.abortHandle = handle.abort;
    this.emitChange();

    handle.promise
      .then((result) => {
        clearProcessingTimer();
        // If the active user has changed to a different user since this item started, drop it immediately so it is never displayed
        if (item.userId && ((this.currentUserId !== null && item.userId !== this.currentUserId) || (this.lastKnownUserId !== null && item.userId !== this.lastKnownUserId))) {
          this.items = this.items.filter((i) => i.localId !== item.localId);
          this.emitChange();
          return;
        }
        if (item.state === "CANCELLED") return;
        item.state = "DONE";
        item.bytesSent = item.totalBytes;
        item.progressPercent = 100;
        item.documentId = result.document.document_id;
        item.documentUrl = `/documents/${result.document.document_id}`;
        item.abortHandle = undefined;
        this.emitChange();
        this.processQueue();
      })
      .catch((err: unknown) => {
        clearProcessingTimer();
        if (item.userId && ((this.currentUserId !== null && item.userId !== this.currentUserId) || (this.lastKnownUserId !== null && item.userId !== this.lastKnownUserId))) {
          this.items = this.items.filter((i) => i.localId !== item.localId);
          this.emitChange();
          return;
        }
        if (item.state === "CANCELLED") return;

        item.state = "FAILED";
        item.abortHandle = undefined;

        if (err instanceof UploadTransportError) {
          if (err.isAborted) {
            item.state = "CANCELLED";
            this.emitChange();
            this.processQueue();
            return;
          }
          if (err.code === "UPLOAD_IN_PROGRESS" || err.status === 409) {
            item.errorCode = "UPLOAD_IN_PROGRESS";
            if (!item.firstInProgressAt) {
              item.firstInProgressAt = Date.now();
            }
            const isStale = (item.retryCount ?? 0) >= 3 || (Date.now() - item.firstInProgressAt >= 180_000);
            if (isStale) {
              item.error = "Upload is taking longer than expected. Please contact an administrator.";
            } else {
              item.error = "Upload is still saving on the server. Retry shortly to check status.";
            }
            this.emitChange();
            this.processQueue();
            return;
          }
          if (err.isAuthExpired) {
            this.isPaused = true;
            this.isAuthExpired = true;
            item.error = "Session expired. Queued files cannot be saved across sign-in; please sign in and re-upload.";
            item.errorCode = "UNAUTHORIZED";
            item.isAuthExpired = true;
            this.emitChange();
            // Do not continue queue: stop immediately
            return;
          }
          if (err.isGoogleAuthExpired) {
            item.error = err.message;
            item.errorCode = "DRIVE_AUTH_EXPIRED";
            item.isGoogleAuthExpired = true;
            item.actionUrl = err.actionUrl;
            this.emitChange();
            this.processQueue();
            return;
          }
          item.error = err.message;
          item.errorCode = err.code;
          item.actionUrl = err.actionUrl;
        } else if (err instanceof Error) {
          item.error = err.message;
        } else {
          item.error = "The upload failed. Please retry.";
        }

        this.emitChange();
        this.processQueue();
      });
  }
}

// Global in-memory singleton that persists across route transitions
export const sharedUploadQueue = new UploadQueue();
