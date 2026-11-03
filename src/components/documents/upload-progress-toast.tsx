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
      if (item.errorCode === "UPLOAD_IN_PROGRESS") {
        const isStale = (item.retryCount ?? 0) >= 3 || (item.firstInProgressAt ? Date.now() - item.firstInProgressAt >= 180_000 : false);
        if (isStale) {
          return "Upload is taking longer than expected. Please contact an administrator.";
        }
        return "Still saving on server…";
      }
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
            {snapshot.isAuthExpired ? (
              <span className="upload-toast-badge-error">!</span>
            ) : activeCount > 0 ? (
              <span className="upload-toast-spinner" />
            ) : snapshot.failedCount > 0 ? (
              <span className="upload-toast-badge-error">!</span>
            ) : (
              <span className="upload-toast-badge-done">✓</span>
            )}
          </span>
          <h2 className="upload-toast-title">
            {snapshot.isAuthExpired ? "Session expired" : summaryTitle}
          </h2>
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

      {snapshot.isAuthExpired && (
        <div className="upload-toast-auth-alert" role="alert">
          <span>Session expired. Queued files do not survive sign-in; please re-upload after signing in.</span>
          <Link href="/login" className="upload-toast-auth-link">
            Sign in
          </Link>
        </div>
      )}

      {!isMinimized && (
        <>
          <ul className="upload-toast-list" role="list">
            {items.map((item) => {
              const isDriveAuthExpired = item.errorCode === "DRIVE_AUTH_EXPIRED" || item.isGoogleAuthExpired;
              const authorizeHref = item.actionUrl ?? (isAdmin ? "/api/admin/drive-setup/authorize" : undefined);
              const canCancel = item.state === "QUEUED" || item.state === "UPLOADING";
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

                      {isDriveAuthExpired && authorizeHref && (
                        <Link href={authorizeHref} className="upload-toast-admin-link">
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

                    {item.state === "PROCESSING" && (
                      <span
                        className="upload-toast-processing-badge"
                        title="Upload is being finalized in Google Drive and cannot be cancelled"
                      >
                        Saving…
                      </span>
                    )}

                    {canRetry && (
                      <button
                        type="button"
                        className="upload-toast-action-btn upload-toast-retry-btn"
                        aria-label={`${item.errorCode === "UPLOAD_IN_PROGRESS" ? "Check status" : "Retry upload"} of ${item.file.name}`}
                        onClick={() => retryItem(item.localId)}
                      >
                        {item.errorCode === "UPLOAD_IN_PROGRESS" ? "Check status" : "Retry"}
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
