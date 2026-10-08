import { batchUploadConcurrency, type BatchUploadItem } from "./batch-upload-types";

export type BatchUploadResponse = { documentId: string; inProgress?: boolean };
export type BatchUploadWorker = (item: BatchUploadItem) => Promise<BatchUploadResponse>;

export function createBatchUploadRunGuard() {
  let running = false;
  return {
    async run(operation: () => Promise<void>): Promise<boolean> {
      if (running) return false;
      running = true;
      try {
        await operation();
        return true;
      } finally {
        running = false;
      }
    },
  };
}

export async function runBatchUploadQueue(input: {
  items: readonly BatchUploadItem[];
  upload: BatchUploadWorker;
  onQueue?: (localIds: readonly string[]) => void;
  onStart: (localId: string) => void;
  onSuccess: (localId: string, result: BatchUploadResponse) => void;
  onFailure: (localId: string, message: string) => void;
  concurrency?: number;
}): Promise<void> {
  const queue = input.items.filter((item) => item.status === "READY");
  input.onQueue?.(queue.map((item) => item.localId));
  const concurrency = Math.min(Math.max(1, input.concurrency ?? batchUploadConcurrency), batchUploadConcurrency);
  let next = 0;

  async function worker() {
    while (next < queue.length) {
      const item = queue[next++];
      input.onStart(item.localId);
      try {
        input.onSuccess(item.localId, await input.upload(item));
      } catch (error) {
        input.onFailure(item.localId, error instanceof Error ? error.message : "The document could not be uploaded. Please retry.");
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
}
