"use client";

import { useState } from "react";

interface DocumentStarButtonProps {
  documentId: string;
  initialStarred: boolean;
}

export function DocumentStarButton({
  documentId,
  initialStarred,
}: DocumentStarButtonProps) {
  const [starred, setStarred] = useState(initialStarred);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/star`, {
        method: "POST",
      });
      if (res.ok) {
        const body = await res.json();
        setStarred(Boolean(body.starred));
      }
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={`table-action ${starred ? "table-action-starred" : ""}`}
      type="button"
      onClick={handleToggle}
      disabled={loading}
      aria-pressed={starred}
      aria-label={starred ? "Unstar document" : "Star document"}
      title={starred ? "Starred document" : "Star this document"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        cursor: loading ? "wait" : "pointer",
      }}
    >
      <span aria-hidden="true" style={{ color: starred ? "#eab308" : "#9ca3af" }}>
        {starred ? "★" : "☆"}
      </span>
      <span>{starred ? "Starred" : "Star"}</span>
    </button>
  );
}
