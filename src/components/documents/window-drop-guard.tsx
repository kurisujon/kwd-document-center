"use client";

import { useEffect } from "react";

/**
 * Window-level drop guard.
 * Prevents the browser's default behavior of navigating away / opening files
 * when a user drops a file anywhere outside an active dropzone.
 */
export function WindowDropGuard() {
  useEffect(() => {
    function handleWindowDragOver(event: DragEvent) {
      event.preventDefault();
      if (event.dataTransfer) {
        // If not over an active drop target, default dropEffect to none
        event.dataTransfer.dropEffect = "none";
      }
    }

    function handleWindowDrop(event: DragEvent) {
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
