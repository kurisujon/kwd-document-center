import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { AdminUploadForm } from "../src/components/documents/admin-upload-form.tsx";
import { getFolderUploadBatchCounts } from "../src/components/documents/folder-upload-review.tsx";
import { adminCategories } from "../src/lib/documents/admin-categories.ts";
import { folderUploadCsvMaxBytes } from "../src/lib/documents/folder-upload-csv.ts";

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

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
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

function csvFile(content: string, name = "metadata.csv") {
  const file = new File([content], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(content).buffer });
  return file;
}

function sizedCsvFile(size: number, onRead: () => void) {
  const file = new File(["relative_path,document_number,subject,document_date,persons_involved\nreport.pdf,,,2027-01-01,"], "metadata.csv", { type: "text/csv" });
  Object.defineProperty(file, "size", { configurable: true, value: size });
  Object.defineProperty(file, "arrayBuffer", { value: async () => { onRead(); return new TextEncoder().encode("relative_path,document_number,subject,document_date,persons_involved\nreport.pdf,,,2027-01-01,").buffer; } });
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

test("Folder batch progress counts derive from actual per-file states", () => {
  const counts = getFolderUploadBatchCounts([
    { status: "READY" }, { status: "QUEUED" }, { status: "UPLOADING" }, { status: "IN_PROGRESS" },
    { status: "UPLOADED" }, { status: "UPLOADED" }, { status: "FAILED", retryDisposition: "RETRYABLE" }, { status: "FAILED" }, { status: "INVALID_FILE" }, { status: "NEEDS_METADATA" },
  ]);
  assert.deepEqual(counts, { total: 10, ready: 1, queued: 1, uploading: 1, inProgress: 1, uploaded: 2, failed: 2, retryableFailures: 1, blockedFailures: 1, invalid: 1, needsMetadata: 1 });
});

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

test("Folder CSV import previews without mutation, applies explicit metadata changes, and preserves queue identities", async () => {
  const generated = useDeterministicUUIDs();
  const posted = installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/January/report.pdf"), folderFile("Root/February/report.pdf")]);
  await completeMetadata(ui, user);
  const initialSubject = (ui.getAllByLabelText("Subject") as HTMLInputElement[])[0]!.value;
  assert.equal(generated.length, 4);

  await user.upload(ui.getByLabelText("Import CSV metadata"), csvFile("relative_path,document_number,subject,document_date,persons_involved\nJanuary/report.pdf,DOC-101,Imported January,2027-02-03,Office A\nFebruary/report.pdf,,Imported February,,"));
  await waitFor(() => assert.match(ui.getByText("CSV import preview").textContent ?? "", /CSV import preview/));
  assert.equal((ui.getAllByLabelText("Subject") as HTMLInputElement[])[0]!.value, initialSubject, "preview does not mutate metadata");
  assert.ok(ui.getAllByText("Will update").length > 0);
  await user.click(ui.getByRole("button", { name: "Apply Metadata" }));
  await waitFor(() => assert.match(ui.getByText(/Metadata applied to 2 files/).textContent ?? "", /applied/));
  const subjects = ui.getAllByLabelText("Subject") as HTMLInputElement[];
  const dates = ui.getAllByLabelText("Date") as HTMLInputElement[];
  const numbers = ui.getAllByLabelText(/Number/) as HTMLInputElement[];
  assert.deepEqual(subjects.map((input) => input.value), ["Imported January", "Imported February"]);
  assert.equal(numbers[0]!.value, "DOC-101");
  assert.equal(dates[0]!.value, "2027-02-03");
  assert.equal(dates[1]!.value, "2027-01-02", "blank cells preserve current metadata");
  assert.equal(generated.length, 4, "CSV apply does not create local or idempotency identities");
  assert.equal(posted.length, 0, "CSV apply does not initiate an upload");
});

test("Folder CSV Apply recalculates metadata readiness without changing the selected file", async () => {
  installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/Ready/report.pdf")]);
  assert.match(ui.getByText("Needs metadata").textContent ?? "", /Needs metadata/);
  assert.equal(uploadButton(ui).disabled, true);
  await user.upload(ui.getByLabelText("Import CSV metadata"), csvFile("relative_path,document_number,subject,document_date,persons_involved\nReady/report.pdf,,Imported subject,2027-02-03,"));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Apply Metadata" })));
  await user.click(ui.getByRole("button", { name: "Apply Metadata" }));
  await waitFor(() => assert.match(ui.getByText("Ready").textContent ?? "", /Ready/));
  assert.equal(uploadButton(ui).disabled, false);
});

test("Folder CSV import rejects unmatched paths atomically, cancels safely, and invalidates a preview when files change", async () => {
  installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/January/report.pdf"), folderFile("Root/February/report.pdf")]);
  await completeMetadata(ui, user);
  const before = (ui.getAllByLabelText("Subject") as HTMLInputElement[]).map((input) => input.value);
  await user.upload(ui.getByLabelText("Import CSV metadata"), csvFile("not a CSV", "metadata.txt"));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent ?? "", /Choose a CSV/));
  await user.upload(ui.getByLabelText("Import CSV metadata"), csvFile("relative_path,document_number,subject,document_date,persons_involved\nMissing/report.pdf,,Unsafe,,"));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent ?? "", /does not match a selected file/));
  assert.deepEqual((ui.getAllByLabelText("Subject") as HTMLInputElement[]).map((input) => input.value), before);

  await user.upload(ui.getByLabelText("Import CSV metadata"), csvFile("relative_path,document_number,subject,document_date,persons_involved\nJanuary/report.pdf,,Preview only,,"));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Cancel Import" })));
  await user.click(ui.getByRole("button", { name: "Cancel Import" }));
  assert.equal(ui.queryByText("CSV import preview"), null);
  assert.deepEqual((ui.getAllByLabelText("Subject") as HTMLInputElement[]).map((input) => input.value), before);

  await user.upload(ui.getByLabelText("Import CSV metadata"), csvFile("relative_path,document_number,subject,document_date,persons_involved\nJanuary/report.pdf,,Preview only,,"));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Apply Metadata" })));
  await user.click(ui.getAllByRole("button", { name: "Remove" })[1]!);
  await waitFor(() => assert.equal(ui.queryByText("CSV import preview"), null));
});

test("Folder CSV import checks the file size before reading and keeps a visible keyboard focus target", async () => {
  installFetch({});
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/report.pdf")]);
  const input = ui.getByLabelText("Import CSV metadata") as HTMLInputElement;
  const control = input.closest("label")!;
  input.focus();
  assert.equal(document.activeElement, input);
  assert.equal(control.matches(":focus-within"), true);
  let oversizedReads = 0;
  await user.upload(input, sizedCsvFile(folderUploadCsvMaxBytes + 1, () => { oversizedReads += 1; }));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent ?? "", /256 KiB/));
  assert.equal(oversizedReads, 0);
  let exactReads = 0;
  await user.upload(input, sizedCsvFile(folderUploadCsvMaxBytes, () => { exactReads += 1; }));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Apply Metadata" })));
  assert.equal(exactReads, 1);
  input.blur();
  assert.equal(control.matches(":focus-within"), false);
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
  await waitFor(() => assert.match(ui.getByText(/2 of 3 uploaded/).textContent ?? "", /Failed: 1/));
  assert.match(ui.getByText(/Retry available: 1/).textContent ?? "", /Retry available/);
  const progress = ui.getByRole("progressbar") as HTMLProgressElement;
  assert.equal(progress.max, 3);
  assert.equal(progress.value, 2);

  for (const mode of ["Files", "Folder"]) assert.equal((ui.getByRole("button", { name: mode }) as HTMLButtonElement).disabled, true);
  assert.equal((ui.getByLabelText("Upload destination") as HTMLSelectElement).disabled, true);
  for (const input of [...ui.getAllByLabelText("Subject"), ...ui.getAllByLabelText("Date")]) assert.equal((input as HTMLInputElement).disabled, true);
  assert.equal(posted.length, 3);
  const failedFirstKey = posted[2]!.body.get("idempotency_key");
  const failedPath = posted[2]!.body.get("source_relative_path");
  assert.equal(posted[2]!.body.get("target_folder_id"), destination.destinationId);
  assert.equal(failedPath, "C/c.pdf");
  for (const field of ["drive_folder_id", "drive_file_id", "drive_url", "content_sha256", "normalized_relative_path_key", "operation_token", "hierarchy_kind", "logical_key"]) assert.equal(posted[2]!.body.has(field), false, field);

  await user.click(ui.getByRole("button", { name: /Retry failed files \(1\)/ }));
  await waitFor(() => assert.equal(posted.length, 4));
  assert.equal(posted[3]!.body.get("idempotency_key"), failedFirstKey);
  assert.equal(posted[3]!.body.get("source_relative_path"), failedPath);
  assert.equal(posted[3]!.body.get("target_folder_id"), destination.destinationId);
  assert.equal(posted.slice(0, 3).filter((request) => request.body.get("source_relative_path") === "A/a.pdf").length, 1);
  assert.equal(posted.slice(0, 3).filter((request) => request.body.get("source_relative_path") === "B/b.pdf").length, 1);
  await waitFor(() => assert.match(ui.getByText(/3 of 3 uploaded/).textContent ?? "", /Failed: 0/));
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
  await user.click(ui.getByRole("button", { name: /Retry failed files \(1\)/ }));
  await waitFor(() => assert.equal(posted.length, 2));
  const second = posted[1]!;
  for (const key of ["idempotency_key", "target_folder_id", "source_relative_path", "subject", "document_date"]) assert.equal(second.body.get(key), first.body.get(key), key);
  assert.equal(second.file?.name, first.file?.name);
  assert.equal(second.file?.size, first.file?.size);
});

test("Folder retry UI classifies blocked and authorization failures safely, while a row Retry preserves its request identity", async () => {
  const blockedPosts = installFetch({ posts: [Response.json({ error: { code: "VALIDATION_ERROR", message: "internal collision diagnostics" } }, { status: 409 })] });
  const blockedUi = renderUpload();
  const blockedUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(blockedUi, blockedUser);
  await chooseFolder(blockedUi, blockedUser, [folderFile("Root/Blocked/one.pdf")]);
  await completeMetadata(blockedUi, blockedUser);
  await blockedUser.click(uploadButton(blockedUi));
  await waitFor(() => assert.match(blockedUi.getByText(/conflicts with an existing folder upload/).textContent ?? "", /cannot be retried/));
  assert.match(blockedUi.getByText(/Needs attention: 1/).textContent ?? "", /Needs attention/);
  assert.equal(blockedUi.queryByRole("button", { name: "Retry" }), null);
  assert.equal(blockedUi.queryByRole("button", { name: /Retry failed files/ }), null);
  assert.equal(blockedUi.queryByText(/internal collision diagnostics/), null);
  assert.equal(blockedPosts.length, 1);

  cleanup();
  const authPosts = installFetch({ posts: [Response.json({ error: { code: "FORBIDDEN", message: "permission detail" } }, { status: 403 })] });
  const authUi = renderUpload();
  const authUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(authUi, authUser);
  await chooseFolder(authUi, authUser, [folderFile("Root/Auth/one.pdf")]);
  await completeMetadata(authUi, authUser);
  await authUser.click(uploadButton(authUi));
  await waitFor(() => assert.match(authUi.getByText(/session or permissions need attention/).textContent ?? "", /continuing/));
  assert.equal(authUi.queryByRole("button", { name: "Retry" }), null);
  assert.equal(authPosts.length, 1);

  cleanup();
  let resolveRetry!: (response: Response) => void;
  const retryPosts = installFetch({ posts: [Response.json({ error: { code: "REGISTRY_ERROR" } }, { status: 503 }), new Promise<Response>((resolve) => { resolveRetry = resolve; })] });
  const retryUi = renderUpload();
  const retryUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(retryUi, retryUser);
  await chooseFolder(retryUi, retryUser, [folderFile("Root/Retry/one.pdf", "same-file")]);
  await completeMetadata(retryUi, retryUser);
  await retryUser.click(uploadButton(retryUi));
  await waitFor(() => assert.match(retryUi.getByText(/could not be confirmed/).textContent ?? "", /safely retry/));
  const first = retryPosts[0]!;
  await retryUser.click(retryUi.getByRole("button", { name: "Retry" }));
  await waitFor(() => assert.equal(retryPosts.length, 2));
  assert.equal(retryUi.queryByRole("button", { name: "Retry" }), null, "an active retry cannot be dispatched twice");
  const second = retryPosts[1]!;
  for (const key of ["idempotency_key", "target_folder_id", "source_relative_path", "subject", "document_date", "persons_involved"]) assert.equal(second.body.get(key), first.body.get(key), key);
  assert.equal(second.file?.name, first.file?.name);
  assert.equal(second.file?.size, first.file?.size);
  assert.equal(second.file?.type, first.file?.type);
  resolveRetry(Response.json({ document: { document_id: "retry-complete" } }));
  await waitFor(() => assert.match(retryUi.getByText("Uploaded").textContent ?? "", /Uploaded/));
});

test("Retry failed files dispatches only retryable failures from a mixed folder batch", async () => {
  const posted = installFetch({
    posts: [
      Response.json({ error: { code: "REGISTRY_ERROR" } }, { status: 503 }),
      Response.json({ error: { code: "DRIVE_ERROR" } }, { status: 503 }),
      Response.json({ error: { code: "VALIDATION_ERROR" } }, { status: 409 }),
      Response.json({ document: { document_id: "uploaded" } }),
      Response.json({ error: { code: "UPLOAD_IN_PROGRESS" } }, { status: 409 }),
      Response.json({ document: { document_id: "retry-a" } }),
      Response.json({ document: { document_id: "retry-b" } }),
    ],
  });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [
    folderFile("Root/A/a.pdf", "a"), folderFile("Root/B/b.pdf", "b"), folderFile("Root/C/conflict.pdf", "c"),
    folderFile("Root/D/uploaded.pdf", "d"), folderFile("Root/E/pending.pdf", "e"),
  ]);
  await completeMetadata(ui, user);
  await user.click(uploadButton(ui));
  await waitFor(() => assert.match(ui.getByText(/Failed: 3/).textContent ?? "", /Retry available: 2/));
  assert.match(ui.getByText(/In progress: 1/).textContent ?? "", /Needs attention: 1/);
  assert.equal(posted.length, 5);
  const originals = new Map(posted.map((request) => [String(request.body.get("source_relative_path")), request]));

  await user.click(ui.getByRole("button", { name: "Retry failed files (2)" }));
  await waitFor(() => assert.equal(posted.length, 7));
  const retryPaths = posted.slice(5).map((request) => String(request.body.get("source_relative_path"))).sort();
  assert.deepEqual(retryPaths, ["A/a.pdf", "B/b.pdf"]);
  for (const request of posted.slice(5)) {
    const original = originals.get(String(request.body.get("source_relative_path")))!;
    for (const key of ["idempotency_key", "target_folder_id", "source_relative_path", "subject", "document_date", "persons_involved"]) assert.equal(request.body.get(key), original.body.get(key), key);
    assert.equal(request.file?.name, original.file?.name);
    assert.equal(request.file?.size, original.file?.size);
  }
  for (const path of ["C/conflict.pdf", "D/uploaded.pdf", "E/pending.pdf"]) assert.equal(posted.filter((request) => request.body.get("source_relative_path") === path).length, 1, path);
  await waitFor(() => assert.match(ui.getByText(/3 of 5 uploaded/).textContent ?? "", /Failed: 1/));
});

test("Check again keeps a repeatedly pending row unresolved, cooled down, and on its original request identity", async () => {
  const posted = installFetch({
    posts: [
      Response.json({ error: { code: "UPLOAD_IN_PROGRESS" } }, { status: 409 }),
      Response.json({ error: { code: "UPLOAD_IN_PROGRESS" } }, { status: 409 }),
      Response.json({ document: { document_id: "completed-replay" } }),
    ],
  });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/Pending/one.pdf", "same-file")]);
  await completeMetadata(ui, user);
  await user.click(uploadButton(ui));
  await waitFor(() => assert.match(ui.getByText("In progress").textContent ?? "", /In progress/));
  const first = posted[0]!;
  const checkAgain = () => ui.getByRole("button", { name: "Check again" }) as HTMLButtonElement;
  assert.equal(checkAgain().disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  await user.click(checkAgain());
  await waitFor(() => assert.equal(posted.length, 2));
  await waitFor(() => assert.match(ui.getByText("In progress").textContent ?? "", /In progress/));
  const second = posted[1]!;
  for (const key of ["idempotency_key", "target_folder_id", "source_relative_path", "subject", "document_date", "persons_involved"]) assert.equal(second.body.get(key), first.body.get(key), key);
  assert.equal(second.file?.name, first.file?.name);
  assert.equal(checkAgain().disabled, true, "a repeated pending replay applies a new cooldown");
  await user.click(checkAgain());
  assert.equal(posted.length, 2, "disabled Check again cannot dispatch while cooled down");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  await user.click(checkAgain());
  await waitFor(() => assert.equal(posted.length, 3));
  const third = posted[2]!;
  for (const key of ["idempotency_key", "target_folder_id", "source_relative_path", "subject", "document_date", "persons_involved"]) assert.equal(third.body.get(key), first.body.get(key), key);
  await waitFor(() => assert.match(ui.getByText("Uploaded").textContent ?? "", /Uploaded/));
});

test("Reset warns before discarding unresolved local retry state and otherwise remains local only", async () => {
  const posted = installFetch({ posts: [Response.json({ error: { code: "UPLOAD_IN_PROGRESS" } }, { status: 409 }), Response.json({ document: { document_id: "reconciled" } })] });
  const ui = renderUpload();
  const user = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(ui, user);
  await chooseFolder(ui, user, [folderFile("Root/Reset/pending.pdf")]);
  await completeMetadata(ui, user);
  await user.click(uploadButton(ui));
  await waitFor(() => assert.match(ui.getByText("In progress").textContent ?? "", /In progress/));
  const first = posted[0]!;

  await user.click(ui.getByRole("button", { name: "Select another folder" }));
  assert.match(ui.getByRole("dialog").textContent ?? "", /server may still be processing/);
  assert.match(ui.getByRole("dialog").textContent ?? "", /does not cancel, delete, or roll back/);
  await user.click(ui.getByRole("button", { name: "Keep current batch" }));
  assert.equal(ui.queryByRole("dialog"), null);
  assert.match(ui.getByText("In progress").textContent ?? "", /In progress/);
  assert.equal(posted.length, 1);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  await waitFor(() => assert.equal((ui.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled, false));
  await user.click(ui.getByRole("button", { name: "Check again" }));
  await waitFor(() => assert.equal(posted.length, 2));
  assert.equal(posted[1]!.body.get("idempotency_key"), first.body.get("idempotency_key"));
  await waitFor(() => assert.match(ui.getByText("Uploaded").textContent ?? "", /Uploaded/));

  cleanup();
  const discardPosts = installFetch({ posts: [Response.json({ error: { code: "UPLOAD_IN_PROGRESS" } }, { status: 409 })] });
  const discardUi = renderUpload();
  const discardUser = userEvent.setup({ document: dom.window.document, applyAccept: false });
  await openFolder(discardUi, discardUser);
  await chooseFolder(discardUi, discardUser, [folderFile("Root/Reset/discard.pdf")]);
  await completeMetadata(discardUi, discardUser);
  await discardUser.click(uploadButton(discardUi));
  await waitFor(() => assert.match(discardUi.getByText("In progress").textContent ?? "", /In progress/));
  await discardUser.click(discardUi.getByRole("button", { name: "Select another folder" }));
  await discardUser.click(discardUi.getByRole("button", { name: "Discard local batch" }));
  await waitFor(() => assert.equal(discardUi.queryByRole("table", { name: "Folder upload review" }), null));
  assert.equal((discardUi.getByLabelText("Upload destination") as HTMLSelectElement).value, "");
  assert.equal(discardPosts.length, 1, "discard does not issue rollback, delete, or reconciliation requests");
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
  assert.equal((ui.getByRole("button", { name: "Select another folder" }) as HTMLButtonElement).disabled, true, "Reset cannot discard an active request");
  assert.equal((ui.getByLabelText("Import CSV metadata") as HTMLInputElement).disabled, true, "CSV import locks after the first attempt");
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
  assert.equal((activeUi.getByRole("button", { name: /Check again \(1\)/ }) as HTMLButtonElement).disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  await waitFor(() => assert.equal((activeUi.getByRole("button", { name: /Check again \(1\)/ }) as HTMLButtonElement).disabled, false));
  await activeUser.click(activeUi.getByRole("button", { name: /Check again \(1\)/ }));
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
