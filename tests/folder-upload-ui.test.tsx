import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { AdminUploadForm } from "../src/components/documents/admin-upload-form.tsx";
import { adminCategories } from "../src/lib/documents/admin-categories.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  Event: dom.window.Event,
  Node: dom.window.Node,
  Text: dom.window.Text,
  MutationObserver: dom.window.MutationObserver,
  File: dom.window.File,
  FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const originalFetch = globalThis.fetch;
const originalRandomUUID = globalThis.crypto.randomUUID;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: originalRandomUUID });
});

const destination = {
  destinationId: "10000000-0000-4000-8000-000000000001",
  kind: "CATEGORY" as const,
  filingYear: 2027,
  category: "BACTI TEST",
  subcategory: null,
  label: "2027 / BACTI TEST",
};

type PostOutcome = Response | Error | Promise<Response>;
type PostedRequest = { body: FormData; file: File | null };

function folderFile(path: string, content = path) {
  const name = path.split("/").at(-1)!;
  const file = new File([content], name, { type: "application/pdf" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

function installFetch(input: { destinations?: typeof destination[]; destinationStatus?: number; posts?: PostOutcome[] }) {
  const posted: PostedRequest[] = [];
  const outcomes = [...(input.posts ?? [])];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/folders/upload-destinations") {
      return Response.json({ destinations: input.destinations ?? [destination] }, { status: input.destinationStatus ?? 200 });
    }
    assert.equal(String(url), "/api/documents");
    assert.equal(init?.method, "POST");
    const body = init?.body as FormData;
    posted.push({ body, file: body.get("file") as File | null });
    const outcome = outcomes.shift() ?? Response.json({ document: { document_id: `document-${posted.length}` } });
    if (outcome instanceof Error) throw outcome;
    return await outcome;
  }) as typeof fetch;
  return posted;
}

function useDeterministicUUIDs() {
  const generated: string[] = [];
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const value = `00000000-0000-4000-8000-${String(generated.length + 1).padStart(12, "0")}`;
      generated.push(value);
      return value;
    },
  });
  return generated;
}

function renderUpload() {
  return render(React.createElement(AdminUploadForm, { categories: adminCategories, maxBytes: 4 * 1024 * 1024 }));
}

async function openFolder(ui: ReturnType<typeof render>, user: ReturnType<typeof userEvent.setup>) {
  await user.click(ui.getByRole("button", { name: "Folder" }));
  await waitFor(() => assert.equal((ui.getByLabelText("Upload destination") as HTMLSelectElement).options.length, 2));
  await user.selectOptions(ui.getByLabelText("Upload destination"), destination.destinationId);
}

async function chooseFolder(ui: ReturnType<typeof render>, user: ReturnType<typeof userEvent.setup>, files: File[]) {
  await user.upload(ui.getByLabelText("Select a folder"), files);
  await waitFor(() => assert.equal(ui.getAllByRole("row").length, files.length + 1));
}

async function completeMetadata(ui: ReturnType<typeof render>, user: ReturnType<typeof userEvent.setup>) {
  const subjects = ui.getAllByLabelText("Subject") as HTMLInputElement[];
  const dates = ui.getAllByLabelText("Date") as HTMLInputElement[];
  for (let index = 0; index < subjects.length; index += 1) {
    await user.type(subjects[index]!, `Subject ${index + 1}`);
    fireEvent.change(dates[index]!, { target: { value: "2027-01-02" } });
  }
}

function uploadButton(ui: ReturnType<typeof render>) {
  return ui.getByRole("button", { name: /Upload folder files/ }) as HTMLButtonElement;
}

test("Folder Upload gates the rendered initial action on every included row and recomputes after removal", async () => {
  installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });

  assert.equal(ui.queryByRole("button", { name: /Upload folder files/ }), null);
  await openFolder(ui, user);
  await user.click(ui.getByRole("button", { name: "Files" }));
  assert.ok(ui.getByLabelText("Select document files"));
  await user.click(ui.getByRole("button", { name: "Folder" }));
  assert.ok(ui.getByLabelText("Upload destination"));
  await chooseFolder(ui, user, [folderFile("Root/January/one.pdf"), folderFile("Root/February/two.pdf")]);
  assert.equal(uploadButton(ui).disabled, true, "two incomplete included rows block the initial upload");

  await user.type((ui.getAllByLabelText("Subject") as HTMLInputElement[])[0]!, "Ready row");
  fireEvent.change((ui.getAllByLabelText("Date") as HTMLInputElement[])[0]!, { target: { value: "2027-01-02" } });
  assert.equal(uploadButton(ui).disabled, true, "one READY row cannot bypass an incomplete included row");

  await user.click(ui.getAllByRole("button", { name: "Remove" })[1]!);
  await waitFor(() => assert.equal(ui.getAllByRole("row").length, 2));
  assert.equal(uploadButton(ui).disabled, false, "explicit removal recomputes the remaining manifest");

  await user.click(ui.getByRole("button", { name: "Select another folder" }));
  assert.equal(ui.queryByRole("button", { name: /Upload folder files/ }), null, "zero included rows have no enabled submission action");
});

test("invalid included files stay visible and block upload until the user explicitly removes them", async () => {
  installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/good.pdf"), folderFile("Root/not-allowed.exe")]);
  await completeMetadata(ui, user);
  assert.match(ui.getByText("Unsupported file type.").textContent ?? "", /Unsupported/);
  assert.equal(uploadButton(ui).disabled, true);

  await user.click(ui.getAllByRole("button", { name: "Remove" })[1]!);
  await waitFor(() => assert.equal(ui.getAllByRole("row").length, 2));
  assert.equal(uploadButton(ui).disabled, false);
});

test("removing a colliding path recomputes survivor validation while preserving its logical row", async () => {
  const generated = useDeterministicUUIDs();
  const posted = installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/January/report.pdf", "survivor"), folderFile("Root/january/report.pdf", "removed")]);
  assert.equal(ui.getAllByText("Duplicate or colliding relative path.").length, 2);
  assert.equal(uploadButton(ui).disabled, true);
  assert.equal(generated.length, 4, "two logical rows receive one idempotency UUID and one local ID each");

  await user.click(ui.getAllByRole("button", { name: "Remove" })[1]!);
  await waitFor(() => assert.equal(ui.queryByText("Duplicate or colliding relative path."), null));
  assert.equal(generated.length, 4, "reusing the surviving row does not generate throwaway UUIDs");
  const number = ui.getByLabelText(/Number/) as HTMLInputElement;
  const subject = ui.getByLabelText("Subject") as HTMLInputElement;
  const date = ui.getByLabelText("Date") as HTMLInputElement;
  const persons = ui.getByLabelText(/Persons/) as HTMLInputElement;
  assert.equal(subject.disabled, false, "the former collision row is re-evaluated as metadata-incomplete, not stale-invalid");
  await user.type(number, "DOC-007");
  await user.type(subject, "Preserved survivor metadata");
  fireEvent.change(date, { target: { value: "2027-01-02" } });
  await user.type(persons, "KWD Test");
  assert.equal(uploadButton(ui).disabled, false);

  await user.click(uploadButton(ui));
  await waitFor(() => assert.equal(posted.length, 1));
  assert.equal(posted[0]!.body.get("idempotency_key"), generated[0]);
  assert.equal(posted[0]!.body.get("source_relative_path"), "January/report.pdf");
  assert.equal(posted[0]!.body.get("document_number"), "DOC-007");
  assert.equal(posted[0]!.body.get("subject"), "Preserved survivor metadata");
  assert.equal(posted[0]!.body.get("document_date"), "2027-01-02");
  assert.equal(posted[0]!.body.get("persons_involved"), "KWD Test");
  assert.equal(posted[0]!.file?.name, "report.pdf");
});

test("Folder requests preserve queue identity through partial failure, failed retry, and reset", async () => {
  const posted = installFetch({
    posts: [
      Response.json({ document: { document_id: "document-a" } }),
      Response.json({ document: { document_id: "document-b" } }),
      Response.json({ error: { code: "INTERNAL_ERROR", message: "Retry safely." } }, { status: 503 }),
      Response.json({ document: { document_id: "document-c" } }),
    ],
  });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/A/a.pdf", "a"), folderFile("Root/B/b.pdf", "b"), folderFile("Root/C/c.pdf", "c")]);
  await completeMetadata(ui, user);
  await user.click(uploadButton(ui));
  await waitFor(() => assert.match(ui.getByText(/Uploaded: 2/).textContent ?? "", /Failed: 1/));

  for (const mode of ["Files", "Folder"]) assert.equal((ui.getByRole("button", { name: mode }) as HTMLButtonElement).disabled, true);
  assert.equal((ui.getByLabelText("Upload destination") as HTMLSelectElement).disabled, true);
  for (const input of [...ui.getAllByLabelText("Subject"), ...ui.getAllByLabelText("Date")]) assert.equal((input as HTMLInputElement).disabled, true);
  assert.equal(posted.length, 3);
  const failedFirstKey = posted[2]!.body.get("idempotency_key");
  const failedPath = posted[2]!.body.get("source_relative_path");
  assert.equal(posted[2]!.body.get("target_folder_id"), destination.destinationId);
  assert.equal(failedPath, "C/c.pdf");
  for (const field of ["drive_folder_id", "drive_file_id", "drive_url", "content_sha256", "normalized_relative_path_key", "operation_token", "hierarchy_kind", "logical_key"]) assert.equal(posted[2]!.body.has(field), false, field);

  await user.click(ui.getByRole("button", { name: /Retry pending files \(1\)/ }));
  await waitFor(() => assert.equal(posted.length, 4));
  assert.equal(posted[3]!.body.get("idempotency_key"), failedFirstKey);
  assert.equal(posted[3]!.body.get("source_relative_path"), failedPath);
  assert.equal(posted[3]!.body.get("target_folder_id"), destination.destinationId);
  assert.equal(posted.slice(0, 3).filter((request) => request.body.get("source_relative_path") === "A/a.pdf").length, 1);
  assert.equal(posted.slice(0, 3).filter((request) => request.body.get("source_relative_path") === "B/b.pdf").length, 1);
  await waitFor(() => assert.match(ui.getByText(/Uploaded: 3/).textContent ?? "", /Failed: 0/));
  assert.equal((ui.getByRole("button", { name: "Files" }) as HTMLButtonElement).disabled, true, "all-success workflows remain locked until reset");

  await user.click(ui.getByRole("button", { name: "Select another folder" }));
  await waitFor(() => assert.equal((ui.getByRole("button", { name: "Files" }) as HTMLButtonElement).disabled, false));
  await user.selectOptions(ui.getByLabelText("Upload destination"), destination.destinationId);
  await chooseFolder(ui, user, [folderFile("Root/New/new.pdf")]);
  await completeMetadata(ui, user);
  assert.equal(uploadButton(ui).disabled, false);
  assert.equal(posted.some((request) => request.body.get("source_relative_path") === "New/new.pdf"), false);
});

test("Folder mode preserves identity for network and in-progress retries and keeps modes locked after any attempt", async () => {
  const posted = installFetch({
    posts: [
      new Error("network unavailable"),
      Response.json({ document: { document_id: "network-replayed" } }),
    ],
  });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/Network/network.pdf", "same-bytes")]);
  await completeMetadata(ui, user);
  await user.click(uploadButton(ui));
  await waitFor(() => assert.match(ui.getByText("Failed").textContent ?? "", /Failed/));
  assert.equal((ui.getByRole("button", { name: "Files" }) as HTMLButtonElement).disabled, true, "all-failed workflows remain locked");
  const first = posted[0]!;
  await user.click(ui.getByRole("button", { name: /Retry pending files \(1\)/ }));
  await waitFor(() => assert.equal(posted.length, 2));
  const second = posted[1]!;
  for (const key of ["idempotency_key", "target_folder_id", "source_relative_path", "subject", "document_date"]) assert.equal(second.body.get(key), first.body.get(key), key);
  assert.equal(second.file?.name, first.file?.name);
  assert.equal(second.file?.size, first.file?.size);
});

test("Folder mode controls lock while a request is actively uploading", async () => {
  let resolveUpload!: (response: Response) => void;
  const posted = installFetch({ posts: [new Promise<Response>((resolve) => { resolveUpload = resolve; })] });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/Active/one.pdf")]);
  await completeMetadata(ui, user);
  await user.click(uploadButton(ui));
  await waitFor(() => assert.equal(posted.length, 1));
  assert.equal((ui.getByRole("button", { name: "Files" }) as HTMLButtonElement).disabled, true);
  assert.match(ui.getByText("Uploading").textContent ?? "", /Uploading/);
  resolveUpload(Response.json({ document: { document_id: "active-complete" } }));
  await waitFor(() => assert.match(ui.getByText("Uploaded").textContent ?? "", /Uploaded/));
});

test("Folder destination states and mode controls behave safely before and after an in-progress attempt", async () => {
  const empty = installFetch({ destinations: [] });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await user.click(ui.getByRole("button", { name: "Folder" }));
  await waitFor(() => assert.match(ui.getByText("No upload-enabled folders are available.").textContent ?? "", /No upload-enabled/));
  assert.equal(ui.queryByText(destination.destinationId), null);
  assert.equal(empty.length, 0);

  cleanup();
  const posted = installFetch({ posts: [Response.json({ error: { code: "UPLOAD_IN_PROGRESS" } }, { status: 409 }), Response.json({ document: { document_id: "complete" } })] });
  const activeUi = renderUpload();
  const activeUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await activeUser.click(activeUi.getByRole("button", { name: "Folder" }));
  await waitFor(() => assert.ok(activeUi.getByRole("option", { name: destination.label })));
  await activeUser.selectOptions(activeUi.getByLabelText("Upload destination"), destination.destinationId);
  await chooseFolder(activeUi, activeUser, [folderFile("Root/InProgress/one.pdf")]);
  await completeMetadata(activeUi, activeUser);
  await activeUser.click(uploadButton(activeUi));
  await waitFor(() => assert.match(activeUi.getByText("In progress").textContent ?? "", /In progress/));
  assert.equal((activeUi.getByRole("button", { name: "Files" }) as HTMLButtonElement).disabled, true);
  const first = posted[0]!;
  await activeUser.click(activeUi.getByRole("button", { name: /Retry pending files \(1\)/ }));
  await waitFor(() => assert.equal(posted.length, 2));
  assert.equal(posted[1]!.body.get("idempotency_key"), first.body.get("idempotency_key"));
  assert.equal(posted[1]!.body.get("source_relative_path"), first.body.get("source_relative_path"));
});

test("Folder destination discovery renders loading and safe error states without a fallback", async () => {
  let resolveDestinations!: (response: Response) => void;
  globalThis.fetch = (async () => new Promise<Response>((resolve) => { resolveDestinations = resolve; })) as typeof fetch;
  const loadingUi = renderUpload();
  const loadingUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await loadingUser.click(loadingUi.getByRole("button", { name: "Folder" }));
  assert.match(loadingUi.getByRole("status").textContent ?? "", /Loading upload destinations/);
  resolveDestinations(Response.json({ destinations: [destination] }));
  await waitFor(() => assert.ok(loadingUi.getByRole("option", { name: destination.label })));

  cleanup();
  globalThis.fetch = (async () => new Response("not available", { status: 503 })) as typeof fetch;
  const errorUi = renderUpload();
  const errorUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await errorUser.click(errorUi.getByRole("button", { name: "Folder" }));
  await waitFor(() => assert.match(errorUi.getByRole("alert").textContent ?? "", /temporarily unavailable/));
  assert.equal(errorUi.queryByText(destination.destinationId), null);
});
