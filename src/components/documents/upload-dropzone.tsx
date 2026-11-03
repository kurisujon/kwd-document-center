"use client";

import React, { useRef, useState, useCallback } from "react";

export interface UploadDropzoneProps {
  id?: string;
  title: string;
  hint: string;
  inputLabel: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  directory?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onFilesSelected: (files: File[]) => void;
  onNonFileRejected?: (message: string) => void;
  children?: React.ReactNode;
}

export function UploadDropzone({
  id,
  title,
  hint,
  inputLabel,
  accept,
  multiple = true,
  disabled = false,
  directory = false,
  inputRef,
  onFilesSelected,
  onNonFileRejected,
  children,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;

      dragCounter.current += 1;
      if (event.dataTransfer?.items && event.dataTransfer.items.length > 0) {
        const hasFileKind = Array.from(event.dataTransfer.items).some(
          (item) => item.kind === "file",
        );
        if (hasFileKind) {
          setIsDragging(true);
        }
      } else if (event.dataTransfer?.types?.includes("Files")) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;

      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragging(false);
      }
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      if (disabled) return;

      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;

      // Filter out non-file items (e.g. text or URL drags from another tab or window)
      if (dataTransfer.items && dataTransfer.items.length > 0) {
        const hasDirectory = Array.from(dataTransfer.items).some((item) => {
          try {
            const entry = (item as unknown as { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.();
            return entry?.isDirectory === true;
          } catch {
            return false;
          }
        });

        if (hasDirectory) {
          if (directory) {
            onNonFileRejected?.("Folder drag-and-drop is not supported yet. Please use the 'Select a folder' button.");
          } else {
            onNonFileRejected?.("Folders cannot be uploaded in batch upload. Please drop individual files or use Folder Upload.");
          }
          return;
        }

        const fileItems = Array.from(dataTransfer.items).filter((item) => item.kind === "file");
        if (fileItems.length === 0) {
          onNonFileRejected?.("Only files can be dropped here.");
          return;
        }

        const files: File[] = [];
        for (const item of fileItems) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }

        if (files.length > 0) {
          onFilesSelected(files);
          return;
        }
      }

      if (dataTransfer.files && dataTransfer.files.length > 0) {
        const files = Array.from(dataTransfer.files);
        onFilesSelected(files);
      } else {
        onNonFileRejected?.("Only files can be dropped here.");
      }
    },
    [disabled, directory, onFilesSelected, onNonFileRejected],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (fileList && fileList.length > 0) {
        onFilesSelected(Array.from(fileList));
      }
      event.target.value = "";
    },
    [onFilesSelected],
  );

  const directoryProps = directory ? ({ webkitdirectory: "" } as unknown as React.InputHTMLAttributes<HTMLInputElement>) : {};

  return (
    <label
      id={id}
      className={`field file-field upload-dropzone ${isDragging ? "upload-dropzone-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="upload-dropzone-icon" aria-hidden="true">
        {children ?? (
          <svg
            width="22"
            height="22"
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
        )}
      </span>
      <span className="upload-dropzone-title">{title}</span>
      <input
        ref={inputRef}
        aria-label={inputLabel}
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        onChange={handleInputChange}
        {...directoryProps}
      />
      <span>{hint}</span>
      {isDragging && (
        <div role="status" aria-live="polite" className="sr-only">
          Ready to drop into {title}.
        </div>
      )}
    </label>
  );
}
