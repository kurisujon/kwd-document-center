"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { stagedUploadStore } from "@/lib/documents/staged-upload-store";

export interface PageWideDropTargetProps {
  target: "documents" | "upload";
  onFilesDropped?: (files: File[]) => void;
  onNonFileRejected?: (message: string) => void;
}

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function PageWideDropTarget({
  target,
  onFilesDropped,
  onNonFileRejected,
}: PageWideDropTargetProps) {
  const router = useSafeRouter();
  const [isDraggingOverPage, setIsDraggingOverPage] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    function handleDragEnter(event: DragEvent) {
      event.preventDefault();
      // Only activate for files
      const types = event.dataTransfer?.types;
      const hasFiles = types && (types.includes("Files") || Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file"));
      if (!hasFiles) return;

      dragCounter.current += 1;
      setIsDraggingOverPage(true);
    }

    function handleDragOver(event: DragEvent) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }

    function handleDragLeave(event: DragEvent) {
      event.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDraggingOverPage(false);
      }
    }

    function handleDrop(event: DragEvent) {
      dragCounter.current = 0;
      setIsDraggingOverPage(false);

      // Check if dropped item was files
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;

      event.preventDefault();
      event.stopPropagation();

      const items = dataTransfer.items ? Array.from(dataTransfer.items).filter((item) => item.kind === "file") : [];
      let files: File[] = [];

      if (items.length > 0) {
        for (const item of items) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      } else if (dataTransfer.files && dataTransfer.files.length > 0) {
        files = Array.from(dataTransfer.files);
      }

      if (files.length === 0) {
        onNonFileRejected?.("Only files can be dropped here.");
        return;
      }

      if (target === "documents") {
        stagedUploadStore.set(files);
        router?.push("/documents/upload");
      } else if (target === "upload") {
        onFilesDropped?.(files);
      }
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [target, onFilesDropped, onNonFileRejected, router]);

  if (!isDraggingOverPage) return null;

  return (
    <div
      className="page-drop-overlay"
      role="region"
      aria-label="Drop files to upload"
      aria-live="polite"
    >
      <div className="page-drop-overlay-card">
        <div className="upload-dropzone-icon" aria-hidden="true" style={{ width: "3.5rem", height: "3.5rem" }}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
        </div>
        <h2 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.25rem", color: "var(--color-brand)" }}>
          {target === "documents" ? "Drop files to open Upload Center" : "Drop files to stage in review list"}
        </h2>
        <p style={{ margin: 0, color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
          {target === "documents"
            ? "Files will be staged in the Upload Center review list."
            : "Files will be added to your current batch upload list."}
        </p>
      </div>
    </div>
  );
}
