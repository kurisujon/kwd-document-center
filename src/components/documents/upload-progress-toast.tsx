"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useUploadQueue } from "./upload-queue-provider";
import type { UploadQueueItem } from "@/lib/documents/upload-queue";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${Math.ceil(kib)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function itemStatusText(item: UploadQueueItem): string {
  switch (item.state) {
    case "QUEUED":
      return "Waiting…";
    case "UPLOADING":
      return `${item.progressPercent}% (${formatBytes(item.bytesSent)} of ${formatBytes(item.totalBytes)})`;
    case "PROCESSING":
      return "Saving to Google Drive…";
    case "DONE":
      return "Uploaded";
    case "FAILED":
      return item.error ?? "Failed";
    case "CANCELLED":
      return "Cancelled";
  }
}

export function UploadProgressToast() {
  const {
    items,
    activeCount,
    snapshot,
    isMinimized,
    toggleMinimize,
    closeToast,
    cancelItem,
    cancelAll,
    retryItem,
    retryAllFailed,
    dismissCompleted,
    user,
  } = useUploadQueue();

  // Announce milestones (started, completed, failed) politely to screen readers
  const announcement = useMemo(() => {
    const failedItem = items.find((i) => i.state === "FAILED");
    if (failedItem) return `Upload failed for ${failedItem.file.name}: ${failedItem.error ?? "error"}`;
    const processingItem = items.find((i) => i.state === "PROCESSING");
    if (processingItem) return `Processing ${processingItem.file.name} in Google Drive.`;
    const doneItem = items.find((i) => i.state === "DONE");
    if (doneItem) return `${doneItem.file.name} uploaded successfully.`;
    return "";
  }, [items]);

  const summaryTitle = (() => {
    if (activeCount > 0) {
      return `Uploading ${activeCount} item${activeCount === 1 ? "" : "s"}`;
    }
    if (snapshot.failedCount > 0) {
      return `${snapshot.completedCount} uploaded, ${snapshot.failedCount} failed`;
    }
    return `${snapshot.completedCount} upload${snapshot.completedCount === 1 ? "" : "s"} complete`;
  })();

  const isAdmin = user?.role === "ADMIN";

  return (
    <aside
      className={`upload-toast ${isMinimized ? "upload-toast-minimized" : ""}`}
      aria-label="Upload progress"
      role="region"
    >
      {/* Live announcement region for screen readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <header className="upload-toast-header">
        <div className="upload-toast-header-info">
          <span className="upload-toast-indicator" aria-hidden="true">
            {activeCount > 0 ? (
              <span className="upload-toast-spinner" />
            ) : snapshot.failedCount > 0 ? (
              <span className="upload-toast-badge-error">!</span>
            ) : (
              <span className="upload-toast-badge-done">✓</span>
            )}
          </span>
          <h2 className="upload-toast-title">{summaryTitle}</h2>
        </div>

        <div className="upload-toast-header-actions">
          <button
            type="button"
            className="upload-toast-header-btn"
            aria-label={isMinimized ? "Expand upload progress" : "Minimize upload progress"}
            aria-expanded={!isMinimized}
            onClick={toggleMinimize}
          >
            {isMinimized ? "▲" : "–"}
          </button>
          <button
            type="button"
            className="upload-toast-header-btn"
            aria-label="Close upload progress panel"
            onClick={closeToast}
          >
            ✕
          </button>
        </div>
      </header>

      {!isMinimized && (
        <>
          <ul className="upload-toast-list" role="list">
            {items.map((item) => {
              const isExpired = item.isGoogleAuthExpired || (item.error && /re-authorize|authorization has expired/i.test(item.error));
              const canCancel = item.state === "QUEUED" || item.state === "UPLOADING" || item.state === "PROCESSING";
              const canRetry = item.state === "FAILED" || item.state === "CANCELLED";

              return (
                <li key={item.localId} className={`upload-toast-item upload-toast-item-${item.state.toLowerCase()}`}>
                  <div className="upload-toast-item-main">
                    <div className="upload-toast-item-header">
                      <span className="upload-toast-item-name" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <span className="upload-toast-item-size">{formatBytes(item.totalBytes)}</span>
                    </div>

                    {item.state === "UPLOADING" && (
                      <div className="upload-toast-progress-bar-wrap">
                        <progress
                          className="upload-toast-progress-bar"
                          value={item.progressPercent}
                          max="100"
                          aria-label={`Upload progress for ${item.file.name}`}
                        />
                      </div>
                    )}

                    <div className="upload-toast-item-status-row">
                      <span className="upload-toast-item-status-text">{itemStatusText(item)}</span>

                      {item.state === "DONE" && item.documentUrl && (
                        <Link href={item.documentUrl} className="upload-toast-view-link">
                          View
                        </Link>
                      )}

                      {isExpired && isAdmin && (
                        <Link href="/admin/drive-setup/authorize" className="upload-toast-admin-link">
                          Re-authorize Drive
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="upload-toast-item-actions">
                    {canCancel && (
                      <button
                        type="button"
                        className="upload-toast-action-btn"
                        aria-label={`Cancel upload of ${item.file.name}`}
                        onClick={() => cancelItem(item.localId)}
                      >
                        Cancel
                      </button>
                    )}

                    {canRetry && (
                      <button
                        type="button"
                        className="upload-toast-action-btn upload-toast-retry-btn"
                        aria-label={`Retry upload of ${item.file.name}`}
                        onClick={() => retryItem(item.localId)}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <footer className="upload-toast-footer">
            <div className="upload-toast-footer-counts">
              {snapshot.completedCount > 0 && <span>{snapshot.completedCount} done</span>}
              {snapshot.failedCount > 0 && <span className="upload-toast-fail-text">{snapshot.failedCount} failed</span>}
            </div>

            <div className="upload-toast-footer-actions">
              {activeCount > 0 && (
                <button
                  type="button"
                  className="upload-toast-footer-btn"
                  onClick={cancelAll}
                >
                  Cancel all
                </button>
              )}

              {snapshot.failedCount > 0 && (
                <button
                  type="button"
                  className="upload-toast-footer-btn upload-toast-retry-all-btn"
                  onClick={retryAllFailed}
                >
                  Retry failed
                </button>
              )}

              {snapshot.isIdle && (
                <button
                  type="button"
                  className="upload-toast-footer-btn"
                  onClick={dismissCompleted}
                >
                  Clear completed
                </button>
              )}
            </div>
          </footer>
        </>
      )}
    </aside>
  );
}
