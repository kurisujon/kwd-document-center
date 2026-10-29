"use client";

export function ReportPrintButton() {
  return (
    <button
      className="button button-secondary"
      type="button"
      onClick={() => window.print()}
    >
      Print inventory
    </button>
  );
}
