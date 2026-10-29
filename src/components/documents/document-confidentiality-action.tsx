"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DocumentConfidentialityAction({
  id,
  confidential,
}: {
  id: string;
  confidential: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(confidential);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();

  async function toggle() {
    const nextValue = !current;
    setPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidential: nextValue }),
      });
      const body = (await response.json()) as {
        document?: { confidential?: boolean };
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "The document access setting could not be updated. Please retry.");
        return;
      }
      const updated = Boolean(body.document?.confidential ?? nextValue);
      setCurrent(updated);
      setStatusMessage(
        updated
          ? "Marked as confidential. Only administrators can view or download this document."
          : "Confidential restriction removed. Authorized staff and viewers can access this document.",
      );
      router.refresh();
    } catch {
      setError("The document access update request could not be completed. Please retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="confidentiality-control">
      <p className="eyebrow">Access control</p>
      <p>
        {current
          ? "Restricted to administrators. Staff and viewers cannot see or open this record."
          : "Visible to all active authorized users."}
      </p>
      <div className="document-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={pending}
          aria-pressed={current}
          onClick={() => void toggle()}
        >
          {pending
            ? "Saving…"
            : current
              ? "Remove confidential restriction"
              : "Mark as confidential"}
        </button>
      </div>
      {statusMessage && (
        <p className="notice" role="status">
          {statusMessage}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
