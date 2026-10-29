"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RetentionStatus } from "@/lib/documents/types";

interface DocumentRetentionActionProps {
  documentId: string;
  initialStatus: RetentionStatus;
  retentionPeriodMonths: number | null;
  isAdmin: boolean;
}

export function DocumentRetentionAction({
  documentId,
  initialStatus,
  retentionPeriodMonths,
  isAdmin,
}: DocumentRetentionActionProps) {
  const router = useRouter();
  const [status, setStatus] = useState<RetentionStatus>(initialStatus);
  const [openDialog, setOpenDialog] = useState<"ARCHIVE" | "DISPOSE" | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!openDialog) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/retention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: openDialog,
          notes: notes.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message || "Failed to process retention action.");
        return;
      }

      setStatus(openDialog === "ARCHIVE" ? "ARCHIVED" : "DISPOSED");
      setOpenDialog(null);
      setNotes("");
      router.refresh();
    } catch {
      setError("Network error executing retention action.");
    } finally {
      setSubmitting(false);
    }
  }

  const periodLabel =
    retentionPeriodMonths === 0
      ? "Permanent (NAP RDS)"
      : retentionPeriodMonths
      ? `${retentionPeriodMonths} months (${Math.round(retentionPeriodMonths / 12)} years)`
      : "Standard default (60 months)";

  return (
    <div style={{ marginTop: "1rem", borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>Records Disposition</p>
      <h3 style={{ margin: "0.25rem 0 0.5rem 0", fontSize: "1rem" }}>Retention lifecycle</h3>
      <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", color: "#4b5563" }}>
        Retention period: <strong>{periodLabel}</strong>
      </p>
      <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#4b5563" }}>
        Retention status: <span className="type-label">{status}</span>
      </p>

      {status === "PENDING_REVIEW" && (
        <div
          role="alert"
          style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            color: "#92400e",
            padding: "0.5rem",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            marginBottom: "0.75rem",
          }}
        >
          This document has met its retention period and is flagged for legal disposition review.
        </div>
      )}

      {isAdmin && status !== "DISPOSED" && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {status !== "ARCHIVED" && (
            <button
              className="button button-secondary"
              type="button"
              style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem" }}
              onClick={() => {
                setOpenDialog("ARCHIVE");
                setError(null);
              }}
            >
              Approve archive
            </button>
          )}
          <button
            className="button button-danger"
            type="button"
            style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem" }}
            onClick={() => {
              setOpenDialog("DISPOSE");
              setError(null);
            }}
          >
            Approve disposal
          </button>
        </div>
      )}

      {openDialog && (
        <div
          className="document-delete-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 100,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            className="confirmation-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retention-dialog-title"
            style={{
              background: "#fff",
              padding: "1.5rem",
              borderRadius: "0.5rem",
              maxWidth: "450px",
              width: "90%",
            }}
          >
            <h2 id="retention-dialog-title">
              {openDialog === "ARCHIVE" ? "Approve document archival" : "Approve record disposal"}
            </h2>
            <p style={{ fontSize: "0.875rem", color: "#4b5563" }}>
              {openDialog === "ARCHIVE"
                ? "This will transition the document to permanent archival records status in accordance with KWD records policies."
                : "This marks the document as legally eligible for disposal under RA 9470 and COA guidelines. Recorded approval will be preserved in the audit log."}
            </p>

            <label htmlFor="retention-notes" style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginTop: "0.75rem" }}>
              Approval notes / RDS justification
            </label>
            <textarea
              id="retention-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Passed 10-year procurement retention requirement per NAP Schedule..."
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "0.375rem",
                border: "1px solid #d1d5db",
                marginTop: "0.25rem",
                boxSizing: "border-box",
              }}
            />

            {error && (
              <p className="form-error" role="alert" style={{ marginTop: "0.5rem" }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                className="button button-secondary"
                type="button"
                disabled={submitting}
                onClick={() => setOpenDialog(null)}
              >
                Cancel
              </button>
              <button
                className={`button ${openDialog === "ARCHIVE" ? "button-primary" : "button-danger"}`}
                type="button"
                disabled={submitting}
                onClick={handleConfirm}
              >
                {submitting ? "Processing…" : `Confirm ${openDialog.toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
