import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { UploadDropzone } from "../src/components/documents/upload-dropzone.tsx";
import { WindowDropGuard } from "../src/components/documents/window-drop-guard.tsx";
import { BatchUploadReview } from "../src/components/documents/batch-upload-review.tsx";
import { stagedUploadStore } from "../src/lib/documents/staged-upload-store.ts";
import {
  stageDroppedBatchFiles,
  type BatchUploadDefaults,
} from "../src/lib/documents/batch-upload-types.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLLabelElement: dom.window.HTMLLabelElement,
  Event: dom.window.Event,
  DragEvent: dom.window.DragEvent,
  Node: dom.window.Node,
  Text: dom.window.Text,
  MutationObserver: dom.window.MutationObserver,
  File: dom.window.File,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  stagedUploadStore.clear();
});

const defaults: BatchUploadDefaults = {
  document_type: "MEMORANDUM",
  filing_year: 2026,
  filing_subcategory: "",
  document_date: "2026-10-30",
  persons_involved: "Staff",
};

function createMockFile(name: string, size = 1024, type = "application/pdf"): File {
  return new dom.window.File(["sample".repeat(Math.ceil(size / 6))], name, { type });
}

test("UploadDropzone renders accessible label, file input, and descriptive hint text", () => {
  const ui = render(
    React.createElement(UploadDropzone, {
      title: "Document files",
      hint: "Accepted files: PDF, Word. Maximum 4 MiB each.",
      inputLabel: "Select document files",
      accept: ".pdf,.docx",
      onFilesSelected: () => {},
    }),
  );

  const input = ui.getByLabelText("Select document files") as HTMLInputElement;
  assert.ok(input);
  assert.equal(input.type, "file");
  assert.equal(input.accept, ".pdf,.docx");
  assert.ok(ui.getByText("Document files"));
  assert.ok(ui.getByText("Accepted files: PDF, Word. Maximum 4 MiB each."));
});

test("UploadDropzone applies active class on dragEnter with files and clears on dragLeave", () => {
  const ui = render(
    React.createElement(UploadDropzone, {
      title: "Document files",
      hint: "Accepted files: PDF",
      inputLabel: "Select document files",
      accept: ".pdf",
      onFilesSelected: () => {},
    }),
  );

  const dropzone = ui.container.querySelector(".upload-dropzone") as HTMLLabelElement;
  assert.ok(dropzone);
  assert.ok(!dropzone.classList.contains("upload-dropzone-active"));

  const fileDataTransfer = {
    types: ["Files"],
    items: [{ kind: "file", type: "application/pdf" }],
  };

  // Drag enter
  fireEvent.dragEnter(dropzone, { dataTransfer: fileDataTransfer });
  assert.ok(dropzone.classList.contains("upload-dropzone-active"));

  // Drag over a child element (counter increments to 2)
  fireEvent.dragEnter(dropzone, { dataTransfer: fileDataTransfer });
  assert.ok(dropzone.classList.contains("upload-dropzone-active"));

  // Leave child element (counter decrements to 1, still active)
  fireEvent.dragLeave(dropzone);
  assert.ok(dropzone.classList.contains("upload-dropzone-active"));

  // Leave dropzone completely (counter decrements to 0, active clears)
  fireEvent.dragLeave(dropzone);
  assert.ok(!dropzone.classList.contains("upload-dropzone-active"));
});

test("UploadDropzone rejects non-file drags (text / URL) with clear feedback and adds nothing", () => {
  let selectedFiles: File[] = [];
  let rejectionMessage: string | undefined;

  const ui = render(
    React.createElement(UploadDropzone, {
      title: "Document files",
      hint: "Accepted files: PDF",
      inputLabel: "Select document files",
      accept: ".pdf",
      onFilesSelected: (files) => {
        selectedFiles = files;
      },
      onNonFileRejected: (message) => {
        rejectionMessage = message;
      },
    }),
  );

  const dropzone = ui.container.querySelector(".upload-dropzone") as HTMLLabelElement;

  // Simulate dropping text or a URL from another tab
  const textDataTransfer = {
    types: ["text/plain", "text/uri-list"],
    items: [
      {
        kind: "string",
        type: "text/plain",
        getAsFile: () => null,
      },
    ],
    files: [],
  };

  fireEvent.drop(dropzone, { dataTransfer: textDataTransfer });

  assert.equal(selectedFiles.length, 0);
  assert.equal(rejectionMessage, "Only files can be dropped here.");
  assert.ok(!dropzone.classList.contains("upload-dropzone-active"));
});

test("UploadDropzone extracts dropped files and invokes onFilesSelected callback", () => {
  let selectedFiles: File[] = [];
  const testFile = createMockFile("official-memo.pdf", 2048);

  const ui = render(
    React.createElement(UploadDropzone, {
      title: "Document files",
      hint: "Accepted files: PDF",
      inputLabel: "Select document files",
      accept: ".pdf",
      onFilesSelected: (files) => {
        selectedFiles = files;
      },
    }),
  );

  const dropzone = ui.container.querySelector(".upload-dropzone") as HTMLLabelElement;

  const fileDataTransfer = {
    types: ["Files"],
    items: [
      {
        kind: "file",
        type: "application/pdf",
        getAsFile: () => testFile,
      },
    ],
    files: [testFile],
  };

  fireEvent.drop(dropzone, { dataTransfer: fileDataTransfer });

  assert.equal(selectedFiles.length, 1);
  assert.equal(selectedFiles[0].name, "official-memo.pdf");
  assert.ok(!dropzone.classList.contains("upload-dropzone-active"));
});

test("stageDroppedBatchFiles caps at 25 files and reports skipped count when exceeding limit", () => {
  const thirtyFiles = Array.from({ length: 30 }, (_, index) =>
    createMockFile(`doc-${index}.pdf`, 1000),
  );

  const result = stageDroppedBatchFiles([], thirtyFiles, defaults);
  assert.equal(result.items.length, 25);
  assert.equal(
    result.message,
    "Added 25 files. 5 files were skipped because batches are limited to 25.",
  );
});

test("stageDroppedBatchFiles flags duplicate files in the same drop with an informative error", () => {
  const file1 = createMockFile("resolution-2026.pdf", 5000);
  const file2 = createMockFile("resolution-2026.pdf", 5000); // Identical duplicate
  const file3 = createMockFile("resolution-unique.pdf", 5000);

  const result = stageDroppedBatchFiles([], [file1, file2, file3], defaults);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].status, "NEEDS_METADATA");
  assert.equal(result.items[1].status, "INVALID_FILE");
  assert.equal(result.items[1].error, "Duplicate file in batch.");
  assert.equal(result.items[2].status, "NEEDS_METADATA");
});

test("stageDroppedBatchFiles flags 0-byte, oversized, and unsupported files with preflight errors", () => {
  const zeroByte = createMockFile("empty.pdf", 0);
  const oversized = createMockFile("huge.pdf", 10 * 1024 * 1024);
  const unsupported = createMockFile("script.exe", 1000, "application/octet-stream");

  const result = stageDroppedBatchFiles([], [zeroByte, oversized, unsupported], defaults);
  assert.equal(result.items.length, 3);

  const zeroItem = result.items.find((i) => i.file.name === "empty.pdf");
  assert.equal(zeroItem?.status, "INVALID_FILE");
  assert.equal(zeroItem?.error, "Select a non-empty file.");

  const overItem = result.items.find((i) => i.file.name === "huge.pdf");
  assert.equal(overItem?.status, "INVALID_FILE");
  assert.match(overItem?.error ?? "", /must not exceed 4 MiB/);

  const unsuppItem = result.items.find((i) => i.file.name === "script.exe");
  assert.equal(unsuppItem?.status, "INVALID_FILE");
  assert.equal(unsuppItem?.error, "This file type is not supported.");
});

test("stagedUploadStore stores and consumes staged files across client navigation", () => {
  const f1 = createMockFile("first.pdf");
  const f2 = createMockFile("second.pdf");

  stagedUploadStore.set([f1, f2]);
  assert.equal(stagedUploadStore.peek().length, 2);

  const consumed = stagedUploadStore.consume();
  assert.equal(consumed.length, 2);
  assert.equal(consumed[0].name, "first.pdf");
  assert.equal(stagedUploadStore.peek().length, 0); // Consumed and cleared
});

test("WindowDropGuard prevents default browser navigation on window dragover and drop for files", () => {
  render(React.createElement(WindowDropGuard));

  const div = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(div);

  const fileDataTransfer = {
    types: ["Files"],
    items: [{ kind: "file" }],
  };

  const event = fireEvent.drop(div, { dataTransfer: fileDataTransfer });
  // fireEvent returns false when preventDefault() was called
  assert.equal(event, false);

  dom.window.document.body.removeChild(div);
});

test("WindowDropGuard does not block text drag and drop into text inputs", () => {
  render(React.createElement(WindowDropGuard));

  const textInput = dom.window.document.createElement("input");
  textInput.type = "text";
  dom.window.document.body.appendChild(textInput);

  const textDataTransfer = {
    types: ["text/plain"],
    items: [{ kind: "string" }],
  };

  const event = fireEvent.drop(textInput, { dataTransfer: textDataTransfer });
  // fireEvent returns true when preventDefault() was NOT called
  assert.equal(event, true, "Text drop into text input should not be prevented");

  dom.window.document.body.removeChild(textInput);
});

test("WindowDropGuard does not block file drops directly onto native file input", () => {
  render(React.createElement(WindowDropGuard));

  const fileInput = dom.window.document.createElement("input");
  fileInput.type = "file";
  dom.window.document.body.appendChild(fileInput);

  const fileDataTransfer = {
    types: ["Files"],
    items: [{ kind: "file" }],
  };

  const event = fireEvent.drop(fileInput, { dataTransfer: fileDataTransfer });
  // fireEvent returns true when preventDefault() was NOT called
  assert.equal(event, true, "File drop directly onto native file input should not be prevented");

  dom.window.document.body.removeChild(fileInput);
});

test("UploadDropzone reports clear failure message when a folder is dropped", () => {
  let rejectionMessage = "";
  const { container } = render(
    React.createElement(UploadDropzone, {
      title: "Folder dropzone",
      inputLabel: "Select a folder",
      directory: true,
      onFilesSelected: () => {},
      onNonFileRejected: (msg) => {
        rejectionMessage = msg;
      },
    }),
  );

  const label = container.querySelector("label");
  assert.ok(label);

  const folderDataTransfer = {
    types: ["Files"],
    items: [
      {
        kind: "file",
        webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
        getAsFile: () => null,
      },
    ],
    files: [],
  };

  fireEvent.drop(label, { dataTransfer: folderDataTransfer });
  assert.equal(rejectionMessage, "Folder drag-and-drop is not supported yet. Please use the 'Select a folder' button.");
});

test("staged files survive React Strict Mode in development", () => {
  const stagedFile = createMockFile("strict-mode-doc.pdf", 4000);
  stagedUploadStore.set([stagedFile]);

  // Render inside React.StrictMode which double-invokes render/initializers
  const { container } = render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(BatchUploadReview, {
        categories: ["MEMORANDUM"],
        maxBytes: 4 * 1024 * 1024,
      }),
    ),
  );

  assert.ok(container.textContent?.includes("strict-mode-doc.pdf"), "Staged file should be visible in Strict Mode");
});
