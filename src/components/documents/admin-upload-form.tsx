"use client";

import { useState } from "react";
import type { AdminCategory } from "@/lib/documents/admin-categories";
import { BatchUploadReview } from "./batch-upload-review";
import { FolderUploadReview } from "./folder-upload-review";

export function AdminUploadForm({ categories, maxBytes }: { categories: readonly AdminCategory[]; maxBytes: number }) {
  const [mode, setMode] = useState<"FILES" | "FOLDER">("FILES");
  const [folderLocked, setFolderLocked] = useState(false);
  return <>
    <div className="upload-mode" aria-label="Upload selection mode">
      <button type="button" aria-pressed={mode === "FILES"} disabled={folderLocked} className={`button ${mode === "FILES" ? "button-primary" : "button-secondary"}`} onClick={() => setMode("FILES")}>Files</button>
      <button type="button" aria-pressed={mode === "FOLDER"} disabled={folderLocked} className={`button ${mode === "FOLDER" ? "button-primary" : "button-secondary"}`} onClick={() => setMode("FOLDER")}>Folder</button>
    </div>
    {folderLocked && <p className="notice">Finish or reset this folder upload before switching modes.</p>}
    <div hidden={mode !== "FILES"}><BatchUploadReview categories={categories} maxBytes={maxBytes} /></div>
    <div hidden={mode !== "FOLDER"}><FolderUploadReview maxBytes={maxBytes} onWorkflowLockChange={setFolderLocked} /></div>
  </>;
}
