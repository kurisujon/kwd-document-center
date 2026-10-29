"use client";

import { useState } from "react";
import type { DocumentCommentRecord } from "@/lib/documents/types";

interface DocumentCommentsPanelProps {
  documentId: string;
  initialComments: DocumentCommentRecord[];
  canComment: boolean;
}

export function DocumentCommentsPanel({
  documentId,
  initialComments,
  canComment,
}: DocumentCommentsPanelProps) {
  const [comments, setComments] = useState<DocumentCommentRecord[]>(initialComments);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newComment.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message || "Failed to post comment.");
        return;
      }

      if (body.comment) {
        setComments((prev) => [...prev, body.comment]);
        setNewComment("");
      }
    } catch {
      setError("Network error while submitting comment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="document-comments-section" aria-label="Document comments">
      <div className="section-heading">
        <p className="eyebrow">Discussion and notes</p>
        <h2>Comments ({comments.length})</h2>
      </div>

      {comments.length === 0 ? (
        <p className="file-unavailable">No comments on this document yet.</p>
      ) : (
        <div className="comments-list" style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
          {comments.map((comment) => (
            <div
              key={comment.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "0.5rem",
                padding: "0.75rem 1rem",
                background: "#fafafa",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.35rem",
                  fontSize: "0.875rem",
                }}
              >
                <div>
                  <strong>{comment.user_name}</strong>{" "}
                  <span className="type-label" style={{ fontSize: "0.75rem" }}>
                    {comment.user_role}
                  </span>
                </div>
                <time style={{ color: "#6b7280", fontSize: "0.75rem" }}>
                  {new Date(comment.created_at).toLocaleString()}
                </time>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#1f2937" }}>
                {comment.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {canComment ? (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <label htmlFor="new-comment-input" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            Add a comment
          </label>
          <textarea
            id="new-comment-input"
            rows={3}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment or compliance note..."
            maxLength={2000}
            disabled={submitting}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid #d1d5db",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "0.5rem",
            }}
          >
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              {newComment.length} / 2000 characters
            </span>
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting || !newComment.trim()}
            >
              {submitting ? "Posting…" : "Post comment"}
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert" style={{ marginTop: "0.5rem" }}>
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="file-unavailable" style={{ fontSize: "0.875rem" }}>
          Only active staff and administrators can post comments.
        </p>
      )}
    </section>
  );
}
