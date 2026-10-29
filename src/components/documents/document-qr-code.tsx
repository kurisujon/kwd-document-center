"use client";

import { useMemo } from "react";
import { generateQrSvg } from "@/lib/qr/qr-generator";

interface DocumentQrCodeProps {
  documentId: string;
  documentNumber: string | null;
  subject: string;
}

export function DocumentQrCode({
  documentId,
  documentNumber,
  subject,
}: DocumentQrCodeProps) {
  // Construct URL based on window location if available, otherwise relative path
  const targetUrl = useMemo(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/documents/${documentId}`;
    }
    return `https://kwd-document-center.local/documents/${documentId}`;
  }, [documentId]);

  const qrSvg = useMemo(() => {
    return generateQrSvg(targetUrl, {
      size: 140,
      margin: 2,
      title: `QR code for ${documentNumber || subject}`,
    });
  }, [targetUrl, documentNumber, subject]);

  return (
    <figure
      className="document-qr-card"
      style={{
        marginTop: "1.25rem",
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.5rem",
        background: "#f9fafb",
        textAlign: "center",
      }}
    >
      <figcaption
        style={{
          fontWeight: 600,
          fontSize: "0.875rem",
          marginBottom: "0.5rem",
          color: "#1f2937",
        }}
      >
        Document Verification QR
      </figcaption>
      <div
        style={{ display: "flex", justifyContent: "center", marginBottom: "0.5rem" }}
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.75rem", color: "#6b7280" }}>
        Scan to view official registry record (auth required).
      </p>
      <button
        className="button button-secondary"
        type="button"
        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
        onClick={() => window.print()}
      >
        Print verification label
      </button>
    </figure>
  );
}
