"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalStepStatus, DocumentApprovalStepRecord } from "@/lib/documents/types";

interface DocumentApprovalWorkflowProps {
  documentId: string;
  initialSteps: DocumentApprovalStepRecord[];
  initialDocStatus: string;
  documentType: string;
  userRole: "VIEWER" | "STAFF" | "ADMIN";
  userId: string;
}

export function DocumentApprovalWorkflow({
  documentId,
  initialSteps,
  initialDocStatus,
  documentType,
  userRole,
  userId,
}: DocumentApprovalWorkflowProps) {
  const router = useRouter();
  const [steps, setSteps] = useState<DocumentApprovalStepRecord[]>(initialSteps);
  const [docStatus, setDocStatus] = useState<string>(initialDocStatus);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const canManage = userRole === "STAFF" || userRole === "ADMIN";
  const activeStep = steps.find((s) => s.status === "IN_PROGRESS");
  const returnedStep = steps.find((s) => s.status === "RETURNED");
  const isAllApproved = steps.length > 0 && steps.every((s) => s.status === "APPROVED");

  const canActOnCurrentStep =
    activeStep &&
    (userRole === "ADMIN" ||
      activeStep.approver_id === userId ||
      (!activeStep.approver_id && activeStep.approver_role === userRole));

  async function handleStartRoute() {
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message || "Failed to start approval route.");
        return;
      }

      setSteps(body.steps);
      setDocStatus("UNDER_REVIEW");
      setSuccessMsg("Approval workflow initiated successfully.");
      router.refresh();
    } catch {
      setError("Network error starting approval route.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecision(action: "APPROVE" | "RETURN") {
    if (!activeStep) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/approvals/${activeStep.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          notes: notes.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message || "Failed to submit decision.");
        return;
      }

      // Re-fetch steps to refresh full sequence
      const stepsRes = await fetch(`/api/documents/${documentId}/approvals`);
      const stepsBody = await stepsRes.json();
      if (stepsRes.ok && stepsBody.steps) {
        setSteps(stepsBody.steps);
      }

      if (body.decision?.document_status) {
        setDocStatus(body.decision.document_status);
      }

      setNotes("");
      setSuccessMsg(
        action === "APPROVE"
          ? body.decision?.is_completed
            ? "Final approval complete! Document marked APPROVED."
            : "Step approved and routed to next review stage."
          : "Step marked RETURNED with feedback notes.",
      );
      router.refresh();
    } catch {
      setError("Network error processing decision.");
    } finally {
      setSubmitting(false);
    }
  }

  function getStatusBadge(status: ApprovalStepStatus) {
    switch (status) {
      case "APPROVED":
        return <span className="type-label" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>✓ Approved</span>;
      case "IN_PROGRESS":
        return <span className="type-label" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>In progress</span>;
      case "RETURNED":
        return <span className="type-label" style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}>Returned</span>;
      case "PENDING":
      default:
        return <span className="type-label" style={{ backgroundColor: "#f3f4f6", color: "#6b7280" }}>Pending</span>;
    }
  }

  return (
    <section className="document-approval-section" aria-label="Approval workflow" style={{ marginTop: "2rem" }}>
      <div className="section-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <p className="eyebrow">Administrative sign-off</p>
          <h2>Approval route & governance</h2>
        </div>
        <span className="type-label" style={{ alignSelf: "flex-start" }}>Status: {docStatus}</span>
      </div>

      {error && (
        <div role="alert" style={{ color: "#b91c1c", backgroundColor: "#fef2f2", padding: "0.75rem", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div role="status" style={{ color: "#15803d", backgroundColor: "#f0fdf4", padding: "0.75rem", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.875rem" }}>
          {successMsg}
        </div>
      )}

      {steps.length === 0 ? (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "6px", padding: "1.25rem" }}>
          <p style={{ margin: "0 0 1rem 0", color: "#4b5563" }}>
            No approval route has been initiated for this document. Documents can follow standard review routes (e.g. Division Head review, Legal/GM sign-off) before reaching final approved status.
          </p>
          {canManage && (
            <button
              type="button"
              className="button button-primary"
              onClick={handleStartRoute}
              disabled={submitting}
            >
              {submitting ? "Initiating..." : `Start Approval Route (${documentType})`}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {isAllApproved && (
            <div style={{ backgroundColor: "#dcfce7", border: "1px solid #86efac", borderRadius: "6px", padding: "1rem", color: "#166534" }}>
              <strong>✓ Document Fully Approved</strong>
              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
                All required routing stages have certified and signed off on this document.
              </p>
            </div>
          )}

          {returnedStep && !activeStep && (
            <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", padding: "1rem", color: "#991b1b" }}>
              <strong>Step {returnedStep.step_number} Returned for Revision</strong>
              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
                Feedback: {returnedStep.notes || "No notes provided."}
              </p>
              {canManage && (
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ marginTop: "0.75rem" }}
                  onClick={handleStartRoute}
                  disabled={submitting}
                >
                  {submitting ? "Restarting..." : "Restart Approval Route"}
                </button>
              )}
            </div>
          )}

          <div className="table-wrap">
            <table aria-label="Approval steps table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Title</th>
                  <th>Required role</th>
                  <th>Status</th>
                  <th>Notes / Feedback</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.id} style={s.status === "IN_PROGRESS" ? { backgroundColor: "#fffbeb" } : undefined}>
                    <td>
                      <strong>Stage {s.step_number}</strong>
                    </td>
                    <td>{s.title}</td>
                    <td>
                      <span className="type-label">{s.approver_role}</span>
                    </td>
                    <td>{getStatusBadge(s.status)}</td>
                    <td style={{ fontSize: "0.875rem", color: s.notes ? "#1f2937" : "#9ca3af" }}>
                      {s.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeStep && canActOnCurrentStep && (
            <div
              style={{
                background: "var(--color-surface)",
                border: "2px solid #3b82f6",
                borderRadius: "6px",
                padding: "1.25rem",
                marginTop: "0.5rem",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>
                Action Required: Stage {activeStep.step_number} ({activeStep.title})
              </h3>
              <p style={{ margin: "0 0 1rem 0", fontSize: "0.875rem", color: "#4b5563" }}>
                You are authorized to review and sign off on this stage. Enter optional justification notes or revision instructions before deciding.
              </p>
              <label htmlFor="approval-notes-input" style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                Decision notes / Feedback
              </label>
              <textarea
                id="approval-notes-input"
                className="input"
                rows={3}
                placeholder="Optional notes for approval, or specific revision requirements if returning..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
                style={{ width: "100%", marginBottom: "1rem" }}
              />
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => handleDecision("APPROVE")}
                  disabled={submitting}
                >
                  {submitting ? "Processing..." : "✓ Approve & Advance"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => handleDecision("RETURN")}
                  disabled={submitting}
                  style={{ color: "#b91c1c", borderColor: "#f87171" }}
                >
                  {submitting ? "Processing..." : "↩ Return for Revision"}
                </button>
              </div>
            </div>
          )}

          {activeStep && !canActOnCurrentStep && (
            <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb", fontSize: "0.875rem", color: "#6b7280" }}>
              ⏳ Awaiting sign-off from <strong>{activeStep.approver_role}</strong> on Stage {activeStep.step_number} ({activeStep.title}).
            </div>
          )}
        </div>
      )}
    </section>
  );
}
