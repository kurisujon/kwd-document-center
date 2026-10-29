"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function TrashDocumentActions({
  id,
  number,
  subject,
}: {
  id: string;
  number: string | null;
  subject: string;
}) {
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  const [purging, setPurging] = useState(false);
  const [showPurgeForm, setShowPurgeForm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [completed, setCompleted] = useState(false);

  async function handleRestore() {
    setRestoring(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/documents/${id}/restore`, {
        method: "POST",
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "The document could not be restored.");
        return;
      }
      setCompleted(true);
      router.refresh();
    } catch {
      setError("The restore request could not be completed. Please retry.");
    } finally {
      setRestoring(false);
    }
  }

  async function handlePurge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("A purge reason is required.");
      return;
    }
    setPurging(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/documents/${id}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmedReason }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "The document could not be purged.");
        return;
      }
      setCompleted(true);
      setShowPurgeForm(false);
      router.refresh();
    } catch {
      setError("The purge request could not be completed. Please retry.");
    } finally {
      setPurging(false);
    }
  }

  const busy = restoring || purging || completed;

  return (
    <div className="trash-actions-wrap">
      <div className="row-actions">
        <button
          className="table-action"
          type="button"
          disabled={busy}
          onClick={() => void handleRestore()}
        >
          {restoring ? "Restoring…" : "Restore"}
          <span className="sr-only"> {subject}</span>
        </button>
        <button
          className="table-action table-action-danger"
          type="button"
          disabled={busy}
          aria-expanded={showPurgeForm}
          onClick={() => {
            setError(undefined);
            setShowPurgeForm((prev) => !prev);
          }}
        >
          Purge
          <span className="sr-only"> {subject}</span>
        </button>
      </div>
      {showPurgeForm && (
        <form
          className="purge-inline-form"
          aria-label={`Purge ${number ?? subject}`}
          onSubmit={(event) => void handlePurge(event)}
        >
          <label className="field">
            Reason for purging (moves file to Google Drive Trash)
            <input
              name="reason"
              type="text"
              required
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g., Duplicate upload or retention period expired"
            />
          </label>
          <div className="row-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setShowPurgeForm(false);
                setError(undefined);
              }}
            >
              Cancel
            </button>
            <button className="button button-danger" type="submit" disabled={busy}>
              {purging ? "Purging…" : "Confirm purge"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
