"use client";

import React, { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react";
import type { AuthorizedUser } from "@/lib/auth/types";
import {
  sharedUploadQueue,
  type EnqueueItemInput,
  type QueueSnapshot,
  type UploadQueue,
  type UploadQueueItem,
} from "@/lib/documents/upload-queue";
import { UploadProgressToast } from "./upload-progress-toast";

interface UploadQueueContextValue {
  snapshot: QueueSnapshot;
  items: UploadQueueItem[];
  hasActive: boolean;
  activeCount: number;
  enqueue: (inputs: EnqueueItemInput[]) => void;
  cancelItem: (localId: string) => void;
  cancelAll: () => void;
  retryItem: (localId: string) => void;
  retryAllFailed: () => void;
  dismissCompleted: () => void;
  clear: () => void;
  isMinimized: boolean;
  toggleMinimize: () => void;
  isOpen: boolean;
  openToast: () => void;
  closeToast: () => void;
  user?: AuthorizedUser;
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

export interface UploadQueueProviderProps {
  children: React.ReactNode;
  user?: AuthorizedUser;
  queue?: UploadQueue;
}

export function UploadQueueProvider({
  children,
  user,
  queue = sharedUploadQueue,
}: UploadQueueProviderProps) {
  const snapshot = useSyncExternalStore(
    (onStoreChange) => queue.subscribe(onStoreChange),
    () => queue.getSnapshot(),
    () => queue.getSnapshot(),
  );

  const [isMinimized, setIsMinimized] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const isOpen = snapshot.items.length > 0 && !isDismissed;

  const value = useMemo<UploadQueueContextValue>(() => ({
    snapshot,
    items: snapshot.items,
    hasActive: snapshot.hasActive,
    activeCount: snapshot.activeCount,
    enqueue: (inputs) => {
      setIsDismissed(false);
      setIsMinimized(false);
      queue.enqueue(inputs);
    },
    cancelItem: (id) => queue.cancelItem(id),
    cancelAll: () => queue.cancelAll(),
    retryItem: (id) => queue.retryItem(id),
    retryAllFailed: () => queue.retryAllFailed(),
    dismissCompleted: () => queue.dismissCompleted(),
    clear: () => {
      queue.clear();
      setIsDismissed(true);
    },
    isMinimized,
    toggleMinimize: () => setIsMinimized((prev) => !prev),
    isOpen,
    openToast: () => setIsDismissed(false),
    closeToast: () => setIsDismissed(true),
    user,
  }), [snapshot, isMinimized, isOpen, queue, user]);

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
      {isOpen && <UploadProgressToast />}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): UploadQueueContextValue {
  const context = useContext(UploadQueueContext);
  if (!context) {
    throw new Error("useUploadQueue must be used within an UploadQueueProvider");
  }
  return context;
}
