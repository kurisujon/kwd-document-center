import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { UploadQueueProvider } from "../src/components/documents/upload-queue-provider.tsx";
import { UploadQueue } from "../src/lib/documents/upload-queue.ts";
import { UploadTransportError } from "../src/lib/documents/upload-transport.ts";
import type { AuthorizedUser } from "../src/lib/auth/types.ts";
import type { BatchUploadMetadata } from "../src/lib/documents/batch-upload-types.ts";

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
});

const staffUser: AuthorizedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "staff@example.test",
  name: "Staff User",
  role: "STAFF",
  status: "ACTIVE",
};

const adminUser: AuthorizedUser = {
  ...staffUser,
  id: "22222222-2222-4222-8222-222222222222",
  role: "ADMIN",
};

const sampleMetadata: BatchUploadMetadata = {
  document_type: "MEMORANDUM",
  filing_year: 2026,
  filing_subcategory: "",
  document_number: "MEMO-1",
  document_date: "2026-10-30",
  subject: "Report",
  persons_involved: "Staff",
};

test("upload-toast-ui: renders progress toast and toggles minimize / expand", () => {
  const queue = new UploadQueue({
    transport: () => ({ abort: () => {}, promise: new Promise(() => {}) }),
  });

  queue.enqueue([
    { localId: "1", file: new File(["data"], "doc1.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);

  const ui = render(
    React.createElement(
      UploadQueueProvider,
      { user: staffUser, queue },
      React.createElement("div", null, "App Content"),
    ),
  );

  assert.ok(ui.getByRole("region", { name: "Upload progress" }));
  assert.ok(ui.getByText("Uploading 1 item"));
  assert.ok(ui.getByText("doc1.pdf"));

  const toggleBtn = ui.getByLabelText("Minimize upload progress");
  fireEvent.click(toggleBtn);

  // Now list should be collapsed
  assert.equal(ui.queryByText("doc1.pdf"), null);
  assert.ok(ui.getByLabelText("Expand upload progress"));

  // Click again to expand
  fireEvent.click(ui.getByLabelText("Expand upload progress"));
  assert.ok(ui.getByText("doc1.pdf"));
  queue.destroy();
});

test("upload-toast-ui: shows admin-only re-authorize link for admins when Google token expires", () => {
  const queue = new UploadQueue({
    transport: () => ({
      abort: () => {},
      promise: Promise.reject(new Error("Google Drive storage connection has expired.")),
    }),
  });

  queue.enqueue([
    { localId: "exp-1", file: new File(["data"], "auth-expired.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);

  // Force expired status simulation
  const item = queue.getSnapshot().items[0]!;
  item.state = "FAILED";
  item.isGoogleAuthExpired = true;
  item.error = "Google Drive authorization has expired. Please re-authorize Google Drive in Admin settings.";

  // Render with ADMIN user
  const adminUi = render(
    React.createElement(
      UploadQueueProvider,
      { user: adminUser, queue },
      React.createElement("div", null, "Admin Workspace"),
    ),
  );

  const adminLink = adminUi.getByRole("link", { name: "Re-authorize Drive" });
  assert.ok(adminLink);
  assert.equal(adminLink.getAttribute("href"), "/admin/drive-setup/authorize");
  adminUi.unmount();

  // Render with STAFF user (non-admin)
  const staffQueue = new UploadQueue({
    transport: () => ({ abort: () => {}, promise: Promise.reject(new Error("Google Drive storage connection has expired.")) }),
  });
  staffQueue.enqueue([
    { localId: "exp-2", file: new File(["data"], "auth-expired-staff.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);
  const staffItem = staffQueue.getSnapshot().items[0]!;
  staffItem.state = "FAILED";
  staffItem.isGoogleAuthExpired = true;
  staffItem.error = "Google Drive authorization has expired. Please contact an administrator.";

  const staffUi = render(
    React.createElement(
      UploadQueueProvider,
      { user: staffUser, queue: staffQueue },
      React.createElement("div", null, "Staff Workspace"),
    ),
  );

  // Staff must NOT see the re-authorize link
  assert.equal(staffUi.queryByRole("link", { name: "Re-authorize Drive" }), null);
  assert.ok(staffUi.getAllByText(/Google Drive authorization has expired/).length > 0);
  staffUi.unmount();
  queue.destroy();
  staffQueue.destroy();
});

test("upload-toast-ui: disables cancel during PROCESSING and displays Saving badge", () => {
  const queue = new UploadQueue({
    transport: () => ({
      abort: () => {},
      promise: new Promise(() => {}),
    }),
  });

  queue.enqueue([
    { localId: "proc-1", file: new File(["data"], "processing-item.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);

  const item = queue.getSnapshot().items[0]!;
  item.state = "PROCESSING";

  const ui = render(
    React.createElement(
      UploadQueueProvider,
      { user: staffUser, queue },
      React.createElement("div", null, "Staff Workspace"),
    ),
  );

  // Cancel button must not exist
  assert.equal(ui.queryByRole("button", { name: "Cancel upload of processing-item.pdf" }), null);
  // Saving badge must be present
  assert.ok(ui.getByText("Saving…"));
  ui.unmount();
  queue.destroy();
});

test("upload-toast-ui: shows session expired banner and sign in link when auth expires", async () => {
  const queue = new UploadQueue({
    transport: () => ({
      abort: () => {},
      promise: Promise.reject(
        new UploadTransportError("Your session has expired. Sign in is required.", 401, "UNAUTHORIZED"),
      ),
    }),
  });

  queue.enqueue([
    { localId: "auth-1", file: new File(["data"], "auth-item.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);

  await new Promise((r) => setTimeout(r, 10));

  const ui = render(
    React.createElement(
      UploadQueueProvider,
      { user: staffUser, queue },
      React.createElement("div", null, "Staff Workspace"),
    ),
  );

  assert.ok(ui.getByRole("alert"));
  const signInLink = ui.getByRole("link", { name: "Sign in" });
  assert.ok(signInLink);
  assert.equal(signInLink.getAttribute("href"), "/login");
  assert.ok(ui.getByText("Session expired. Queued files do not survive sign-in; please re-upload after signing in."));
  ui.unmount();
  queue.destroy();
});

test("upload-toast-ui: shows Still saving status and Check status button when upload is in progress", () => {
  const queue = new UploadQueue({
    transport: () => ({
      abort: () => {},
      promise: new Promise(() => {}),
    }),
  });

  queue.enqueue([
    { localId: "item-inprogress", file: new File(["data"], "saving-item.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);

  const item = queue.getSnapshot().items[0]!;
  item.state = "FAILED";
  item.errorCode = "UPLOAD_IN_PROGRESS";
  item.error = "Upload is still saving on the server. Retry shortly to check status.";

  const ui = render(
    React.createElement(
      UploadQueueProvider,
      { user: staffUser, queue },
      React.createElement("div", null, "Staff Workspace"),
    ),
  );

  // Status text should say Still saving on server…
  assert.ok(ui.getByText("Still saving on server…"));
  // Action button should be labeled Check status
  const checkStatusBtn = ui.getByRole("button", { name: "Check status of saving-item.pdf" });
  assert.ok(checkStatusBtn);
  assert.equal(checkStatusBtn.textContent, "Check status");

  ui.unmount();
  queue.destroy();
});

test("upload-toast-ui: transitions from Still saving to contact administrator after limit is reached", () => {
  const queue = new UploadQueue({
    transport: () => ({
      abort: () => {},
      promise: new Promise(() => {}),
    }),
  });

  queue.enqueue([
    { localId: "item-stale", file: new File(["data"], "stale-item.pdf", { type: "application/pdf" }), metadata: sampleMetadata },
  ]);

  const item = queue.getSnapshot().items[0]!;
  item.state = "FAILED";
  item.errorCode = "UPLOAD_IN_PROGRESS";
  item.retryCount = 3;
  item.error = "Upload is taking longer than expected. Please contact an administrator.";

  const ui = render(
    React.createElement(
      UploadQueueProvider,
      { user: staffUser, queue },
      React.createElement("div", null, "Staff Workspace"),
    ),
  );

  // Status text should say contact administrator
  assert.ok(ui.getByText("Upload is taking longer than expected. Please contact an administrator."));
  // Action button remains available
  const checkStatusBtn = ui.getByRole("button", { name: "Check status of stale-item.pdf" });
  assert.ok(checkStatusBtn);

  ui.unmount();
  queue.destroy();
});
