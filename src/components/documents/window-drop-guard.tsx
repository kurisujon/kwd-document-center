"use client";

import { useEffect } from "react";

function isUnprotectedTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  // Native file input
  if (tag === "input" && (target as HTMLInputElement).type === "file") return true;
  // Form text inputs, textareas, contenteditable elements
  if (
    tag === "input" ||
    tag === "textarea" ||
    target.isContentEditable ||
    Boolean(target.closest("input, textarea, [contenteditable='true']"))
  ) {
    return true;
  }
  // Inside active dropzone
  if (Boolean(target.closest(".upload-dropzone, .page-drop-overlay"))) {
    return true;
  }
  return false;
}

function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return types.includes("Files") || Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
}

/**
 * Window-level drop guard.
 * Prevents the browser's default behavior of navigating away / opening files
 * when a user drops a file anywhere outside an active dropzone.
 * Does not block text drops into form controls or drops onto native file inputs.
 */
export function WindowDropGuard() {
  useEffect(() => {
    function handleWindowDragOver(event: DragEvent) {
      // If it's not a file drag (e.g. text drag), allow default browser handling
      if (!isFileDrag(event)) return;

      // If the target is an input, textarea, native file input, or dropzone, don't intercept
      if (isUnprotectedTarget(event.target)) return;

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "none";
      }
    }

    function handleWindowDrop(event: DragEvent) {
      // If it's not a file drop (e.g. text drop into input), do not intercept
      if (!isFileDrag(event)) return;

      // If dropped directly onto a file input or inside a dropzone, don't intercept
      if (isUnprotectedTarget(event.target)) return;

      event.preventDefault();
    }

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  return null;
}
