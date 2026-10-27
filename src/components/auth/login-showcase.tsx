"use client";

import { useEffect, useState } from "react";

const workflowSteps = [
  {
    label: "Validating document metadata",
    detail: "Checking document number, date & category",
    isLoader: true,
  },
  {
    label: "Uploading to KWD Google Drive",
    detail: "Routing file to mapped destination folder",
    isLoader: false,
  },
  {
    label: "Writing official registry record",
    detail: "Linking Drive File ID to Supabase registry",
    isLoader: false,
  },
  {
    label: "Ready for instant staff search",
    detail: "Indexed by number, subject, date & person",
    isLoader: false,
  },
];

export function LoginShowcase() {
  const [stepIndex, setStepIndex] = useState(2);
  const [progress, setProgress] = useState(82);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    const progressInterval = window.setInterval(() => {
      setProgress((current) => (current >= 100 ? 100 : current + 2));
    }, 55);

    const stepTimer = window.setTimeout(() => {
      setStepIndex((current) => (current + 1) % (workflowSteps.length + 1));
      setProgress(24);
    }, 2400);

    return () => {
      window.clearInterval(progressInterval);
      window.clearTimeout(stepTimer);
    };
  }, [reducedMotion, stepIndex]);

  const completedCount = stepIndex;
  const overallPercent = Math.min(100, Math.round((stepIndex / workflowSteps.length) * 100));

  return (
    <div className="login-showcase-wrap" aria-label="Document workflow preview">
      <div className="login-preview-card">
        <div className="login-preview-header">
          <div className="login-preview-doc">
            <span className="login-preview-doc-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h6" />
              </svg>
            </span>
            <div>
              <strong>KWD-RES-2026-042.pdf</strong>
              <span>Board Resolution · Google Drive</span>
            </div>
          </div>
          <span className="login-preview-pill">Verified</span>
        </div>

        <div className="login-preview-steps">
          {workflowSteps.map((step, idx) => {
            const isCompleted = idx < completedCount;
            const isCurrent = idx === completedCount;
            const stateClass = isCompleted
              ? "login-step-done"
              : isCurrent
              ? "login-step-current"
              : "login-step-pending";

            return (
              <div key={step.label} className={`login-step-row ${stateClass}`}>
                <span className="login-step-indicator" aria-hidden="true">
                  {isCompleted ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  ) : isCurrent ? (
                    <span className="login-step-pulse" />
                  ) : (
                    <span className="login-step-dot" />
                  )}
                </span>
                <div className="login-step-copy">
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                {isCompleted ? (
                  <span className="login-step-tag login-step-tag-done">Done</span>
                ) : isCurrent ? (
                  <span className="login-step-tag login-step-tag-active">{progress}%</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="login-preview-footer">
          <div className="login-preview-footer-meta">
            <span>Registry &amp; Drive Pipeline</span>
            <strong>{overallPercent}%</strong>
          </div>
          <div className="login-preview-progress-track" aria-hidden="true">
            <div className="login-preview-progress-fill" style={{ width: `${overallPercent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
