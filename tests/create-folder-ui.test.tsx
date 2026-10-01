import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { CreateFolderAction } from "../src/components/documents/create-folder-action.tsx";
import { DocumentPageActions } from "../src/components/documents/document-page-actions.tsx";
import { adminCategories } from "../src/lib/documents/admin-categories.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, self: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, InputEvent: dom.window.InputEvent, Node: dom.window.Node, Text: dom.window.Text, MutationObserver: dom.window.MutationObserver });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number, cancelAnimationFrame: (id: number) => clearTimeout(id) });
const { cleanup, render, waitFor } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
afterEach(() => { cleanup(); });

function renderAction() { return render(React.createElement(CreateFolderAction, { categories: adminCategories })); }
async function openAndFill(ui: ReturnType<typeof renderAction>) {
  const user = userEvent.setup({ document: dom.window.document });
  await user.click(ui.getByRole("button", { name: "Create folder" }));
  await user.type(ui.getByLabelText("Folder name"), "PH7C UI TEST");
  await waitFor(() => assert.equal((ui.getByLabelText("Folder name") as HTMLInputElement).value, "PH7C UI TEST"));
}

test("Create Folder renders, opens, previews its logical destination, and cancels", async () => {
  const ui = renderAction();
  const user = userEvent.setup({ document: dom.window.document });
  assert.ok(ui.getByRole("button", { name: "Create folder" }));
  await openAndFill(ui);
  assert.ok(ui.getByRole("dialog"));
  assert.ok(ui.getByLabelText("Document type"));
  assert.ok(ui.getByLabelText("Filing year"));
  assert.match(ui.getByText(/ADMIN\|2026\|BACTI TEST → PH7C UI TEST/).textContent ?? "", /PH7C UI TEST/);
  assert.equal(ui.queryByDisplayValue(/drive/i), null);
  await user.click(ui.getByRole("button", { name: "Cancel" }));
  assert.equal(ui.queryByRole("dialog"), null);
});

test("real Documents-page action boundary renders Create Folder only for ADMIN", () => {
  for (const [role, present] of [["ADMIN", true], ["STAFF", false], ["VIEWER", false]] as const) {
    const ui = render(React.createElement(DocumentPageActions, { role }));
    assert.equal(Boolean(ui.queryByRole("button", { name: "Create folder" })), present, role);
    cleanup();
  }
});

test("Create Folder synchronous guard permits one rapid request and then shows safe success/idempotent/error feedback", async () => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Promise<Response>((done) => { resolve = done; }); }) as typeof fetch;
  const ui = renderAction(); await openAndFill(ui);
  const submit = ui.getByRole("button", { name: "Create Folder" });
  const user = userEvent.setup({ document: dom.window.document });
  void user.click(submit); void user.click(submit);
  await waitFor(() => assert.equal(calls, 1));
  resolve(Response.json({ folder: { name: "PH7C UI TEST", destination: "ADMIN|2026|BACTI TEST", created: true } }, { status: 201 }));
  await waitFor(() => assert.match(ui.getByRole("status").textContent ?? "", /PH7C UI TEST/));
  assert.doesNotMatch(document.body.textContent ?? "", /drive_folder_id|operation_token|refresh_token/i);

  globalThis.fetch = (async () => Response.json({ folder: { name: "PH7C UI TEST", destination: "ADMIN|2026|BACTI TEST", created: false } }, { status: 200 })) as typeof fetch;
  await user.type(ui.getByLabelText("Folder name"), "PH7C UI TEST");
  await user.click(ui.getByRole("button", { name: "Create Folder" }));
  await waitFor(() => assert.match(ui.getByRole("status").textContent ?? "", /already exists/));

  globalThis.fetch = (async () => Response.json({ error: { message: "A folder with this name already exists in the selected destination." } }, { status: 409 })) as typeof fetch;
  await user.clear(ui.getByLabelText("Folder name")); await user.type(ui.getByLabelText("Folder name"), "CONFLICT");
  await user.click(ui.getByRole("button", { name: "Create Folder" }));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent ?? "", /already exists/));
  assert.equal((ui.getByRole("button", { name: "Create Folder" }) as HTMLButtonElement).disabled, false);

  globalThis.fetch = (async () => Response.json({ error: { message: "The folder could not be created. Please retry." } }, { status: 503 })) as typeof fetch;
  await user.clear(ui.getByLabelText("Folder name")); await user.type(ui.getByLabelText("Folder name"), "UNAVAILABLE");
  await user.click(ui.getByRole("button", { name: "Create Folder" }));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent ?? "", /could not be created/));
  assert.equal((ui.getByRole("button", { name: "Create Folder" }) as HTMLButtonElement).disabled, false);
  assert.doesNotMatch(document.body.textContent ?? "", /google|drive_folder_id|operation_token|stack/i);
});
