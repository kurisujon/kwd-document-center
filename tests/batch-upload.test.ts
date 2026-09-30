import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  batchFilePreflight,
  batchUploadConcurrency,
  canSelectBatchFiles,
  createBatchUploadItem,
  deriveBatchItemStatus,
  appendBatchFiles,
  applyToSelectedBatchItems,
  isBatchItemEditable,
  maximumBatchUploadFiles,
  removeEditableBatchItem,
  refreshBatchItem,
  prepareFailedBatchRetry,
  selectAllEditableBatchItems,
  type BatchUploadItem,
} from "../src/lib/documents/batch-upload-types.ts";
import { createBatchUploadRunGuard, runBatchUploadQueue } from "../src/lib/documents/batch-upload-queue.ts";
import { adminUploadFormats } from "../src/lib/documents/upload-formats.ts";
import { BatchUploadReview, BatchUploadRow } from "../src/components/documents/batch-upload-review.tsx";
import { adminCategories } from "../src/lib/documents/admin-categories.ts";

const defaults = {
  document_type: "BACTI TEST" as const,
  filing_year: 2026,
  filing_subcategory: "",
  document_date: "2026-09-30",
  persons_involved: "KWD",
};

function file(name = "memo.pdf", type = "application/pdf", size = 3) {
  return new File([new Uint8Array(size)], name, { type });
}

function ready(localId: string): BatchUploadItem {
  const item = createBatchUploadItem(file(`${localId}.pdf`), defaults, `${localId}0000-0000-4000-8000-000000000000`);
  return refreshBatchItem({ ...item, localId, metadata: { ...item.metadata, subject: `Subject ${localId}` } });
}

test("batch items are independent, preserve per-file metadata, and keep a future relative-path field", () => {
  const first = createBatchUploadItem(file("first.pdf"), defaults);
  const second = createBatchUploadItem(file("second.pdf"), { ...defaults, persons_involved: "Other" });
  assert.notEqual(first.localId, second.localId);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.metadata.document_number, "");
  assert.equal(first.metadata.subject, "");
  assert.equal(first.metadata.persons_involved, "KWD");
  assert.equal(second.metadata.persons_involved, "Other");
  assert.equal(first.relativePath, undefined);
  assert.equal(first.status, "NEEDS_METADATA");
});

test("client preflight independently retains the approved formats and rejects obvious unsupported, oversized, and mismatched files", () => {
  for (const [extension, format] of Object.entries(adminUploadFormats)) {
    const compatible = "compatibleMimeTypes" in format ? format.compatibleMimeTypes[0] ?? format.mimeType : format.mimeType;
    assert.equal(batchFilePreflight(file(`approved${extension}`, compatible)), undefined, extension);
  }
  assert.match(batchFilePreflight(file("malware.exe", "application/x-msdownload")) ?? "", /not supported/i);
  assert.match(batchFilePreflight(file("large.pdf", "application/pdf", 4 * 1024 * 1024 + 1)) ?? "", /must not exceed/i);
  assert.match(batchFilePreflight(file("wrong.pdf", "image/png")) ?? "", /inconsistent/i);
  assert.match(batchFilePreflight(file("binary.csv", "application/octet-stream")) ?? "", /inconsistent/i);
});

test("row readiness requires per-file subject/date and preserves independent overrides", () => {
  const item = createBatchUploadItem(file(), defaults, "10000000-0000-4000-8000-000000000000");
  assert.equal(deriveBatchItemStatus(item), "NEEDS_METADATA");
  const readyItem = refreshBatchItem({ ...item, metadata: { ...item.metadata, subject: "Memo", document_number: "M-001", persons_involved: "Maria", document_date: "2026-09-29" } });
  assert.equal(readyItem.status, "READY");
  assert.equal(readyItem.metadata.document_number, "M-001");
  assert.equal(readyItem.metadata.subject, "Memo");
  assert.equal(readyItem.metadata.persons_involved, "Maria");
  assert.equal(readyItem.metadata.document_date, "2026-09-29");
});

test("batch limits and concurrency constants remain conservative", () => {
  assert.equal(maximumBatchUploadFiles, 25);
  assert.equal(batchUploadConcurrency, 3);
  assert.equal(canSelectBatchFiles(0, 25), true);
  assert.equal(canSelectBatchFiles(24, 1), true);
  assert.equal(canSelectBatchFiles(24, 2), false);
  assert.equal(canSelectBatchFiles(25, 1), false);
  assert.match(batchFilePreflight(file("configured.pdf", "application/pdf", 6), 5) ?? "", /must not exceed/i);
});

test("selection cap keeps existing rows stable across exact, excessive, and repeated selections", () => {
  const twentyFive = Array.from({ length: 25 }, (_value, index) => file(`first-${index}.pdf`));
  const exact = appendBatchFiles([], twentyFive, defaults);
  assert.equal(exact.error, undefined);
  assert.equal(exact.items.length, 25);

  const overInitial = appendBatchFiles([], [...twentyFive, file("extra.pdf")], defaults);
  assert.equal(overInitial.items.length, 0);
  assert.match(overInitial.error ?? "", /no more than 25/i);

  const existing = exact.items.slice(0, 24);
  const oneMore = appendBatchFiles(existing, [file("last.pdf")], defaults);
  assert.equal(oneMore.items.length, 25);
  assert.equal(oneMore.items[0].localId, existing[0].localId);
  const excess = appendBatchFiles(oneMore.items, [file("too-many.pdf")], defaults);
  assert.equal(excess.items.length, 25);
  assert.equal(excess.items[0].localId, oneMore.items[0].localId);
  assert.match(excess.error ?? "", /no more than 25/i);
});

test("common defaults and selected bulk metadata updates change only intended editable rows", () => {
  const first = ready("first");
  const second = { ...ready("second"), metadata: { ...ready("second").metadata, subject: "Intentional override", persons_involved: "Original", document_date: "2026-09-01" } };
  const uploaded = { ...ready("done"), status: "UPLOADED" as const };
  const selected = new Set([first.localId]);
  const common = { ...defaults, document_type: "MEMORANDUM" as const, filing_year: 2026, filing_subcategory: "", document_date: "2026-09-30", persons_involved: "Common" };
  const defaultsApplied = applyToSelectedBatchItems([first, second, uploaded], selected, (item) => ({ ...item, metadata: { ...item.metadata, ...common } }));
  assert.equal(defaultsApplied[0].metadata.document_type, "MEMORANDUM");
  assert.equal(defaultsApplied[0].metadata.document_date, "2026-09-30");
  assert.equal(defaultsApplied[0].metadata.persons_involved, "Common");
  assert.equal(defaultsApplied[1].metadata.subject, "Intentional override");
  assert.equal(defaultsApplied[1].metadata.persons_involved, "Original");
  assert.equal(defaultsApplied[2].metadata.document_type, uploaded.metadata.document_type);

  const datesApplied = applyToSelectedBatchItems(defaultsApplied, new Set([first.localId, uploaded.localId]), (item) => ({ ...item, metadata: { ...item.metadata, document_date: "2026-10-01" } }));
  assert.equal(datesApplied[0].metadata.document_date, "2026-10-01");
  assert.equal(datesApplied[2].metadata.document_date, uploaded.metadata.document_date);
  const peopleApplied = applyToSelectedBatchItems(datesApplied, new Set([second.localId, uploaded.localId]), (item) => ({ ...item, metadata: { ...item.metadata, persons_involved: "" } }));
  assert.equal(peopleApplied[1].metadata.persons_involved, "");
  assert.equal(peopleApplied[2].metadata.persons_involved, uploaded.metadata.persons_involved);
});

test("select all and queued removal include only editable rows and keep selection consistent", () => {
  const queued = { ...ready("queued"), status: "QUEUED" as const };
  const readyRow = ready("ready");
  const uploaded = { ...ready("uploaded"), status: "UPLOADED" as const };
  const uploading = { ...ready("uploading"), status: "UPLOADING" as const };
  const items = [queued, readyRow, uploaded, uploading];
  const selected = selectAllEditableBatchItems(items);
  assert.deepEqual([...selected].sort(), [queued.localId, readyRow.localId].sort());
  assert.equal(isBatchItemEditable(uploaded), false);
  const removed = removeEditableBatchItem(items, selected, queued.localId);
  assert.equal(removed.items.some((item) => item.localId === queued.localId), false);
  assert.equal(removed.selected.has(queued.localId), false);
  assert.equal(removeEditableBatchItem(removed.items, removed.selected, uploaded.localId).items.length, removed.items.length);
  assert.equal(removeEditableBatchItem(removed.items, removed.selected, uploading.localId).items.length, removed.items.length);
});

test("mixed valid, unsupported, oversized, and MIME-mismatched rows remain independently classified", () => {
  const validPdf = refreshBatchItem({ ...createBatchUploadItem(file("valid.pdf"), defaults), metadata: { ...createBatchUploadItem(file("valid.pdf"), defaults).metadata, subject: "Valid" } });
  const validJpg = refreshBatchItem({ ...createBatchUploadItem(file("valid.jpg", "image/jpeg"), defaults), metadata: { ...createBatchUploadItem(file("valid.jpg", "image/jpeg"), defaults).metadata, subject: "Image" } });
  const invalidExe = createBatchUploadItem(file("bad.exe", "application/x-msdownload"), defaults);
  const oversized = createBatchUploadItem(file("large.pdf", "application/pdf", 4 * 1024 * 1024 + 1), defaults);
  const mismatch = createBatchUploadItem(file("wrong.pdf", "image/png"), defaults);
  assert.equal(validPdf.status, "READY");
  assert.equal(validJpg.status, "READY");
  for (const item of [invalidExe, oversized, mismatch]) assert.equal(item.status, "INVALID_FILE");
});

test("bounded queue never exceeds three requests, isolates failures, and does not submit non-ready rows", async () => {
  const items = ["one", "two", "three", "four", "five"].map(ready);
  items.push({ ...ready("invalid"), status: "INVALID_FILE", error: "Unsupported" });
  let active = 0;
  let maximumActive = 0;
  const started: string[] = [];
  const uploaded: string[] = [];
  const failed: string[] = [];
  await runBatchUploadQueue({
    items,
    upload: async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (item.localId === "three") throw new Error("Safe provider failure");
      return { documentId: `${item.localId}-document` };
    },
    onStart: (id) => started.push(id),
    onSuccess: (id) => uploaded.push(id),
    onFailure: (id) => failed.push(id),
  });
  assert.equal(maximumActive, 3);
  assert.deepEqual(started.sort(), ["five", "four", "one", "three", "two"]);
  assert.deepEqual(uploaded.sort(), ["five", "four", "one", "two"]);
  assert.deepEqual(failed, ["three"]);
});

test("failed retry retains its original idempotency key and completed rows are not resubmitted", async () => {
  const failed = { ...ready("retry"), status: "READY" as const };
  const uploaded = { ...ready("done"), status: "UPLOADED" as const };
  const keys: string[] = [];
  const run = async () => runBatchUploadQueue({
    items: [failed, uploaded],
    upload: async (item) => { keys.push(item.idempotencyKey); return { documentId: item.localId }; },
    onStart: () => {}, onSuccess: () => {}, onFailure: () => {},
  });
  await run();
  await run();
  assert.deepEqual(keys, [failed.idempotencyKey, failed.idempotencyKey]);
  assert.ok(!keys.includes(uploaded.idempotencyKey));
});

test("Retry Failed makes only formerly failed rows eligible and retains their idempotency keys", async () => {
  const failed = { ...ready("failed"), status: "FAILED" as const, error: "Provider" };
  const uploaded = { ...ready("uploaded-again"), status: "UPLOADED" as const };
  const readyRow = ready("ready-again");
  const invalid = { ...ready("invalid-again"), status: "INVALID_FILE" as const };
  const missing = { ...ready("missing"), status: "NEEDS_METADATA" as const };
  const uploading = { ...ready("active"), status: "UPLOADING" as const };
  const retry = prepareFailedBatchRetry([failed, uploaded, readyRow, invalid, missing, uploading]);
  const retried = retry.items;
  const retryCandidates = retry.candidates;
  assert.equal(retryCandidates.length, 1);
  assert.equal(retryCandidates[0].idempotencyKey, failed.idempotencyKey);
  assert.deepEqual(retried.filter((item) => item.localId !== failed.localId).map((item) => item.status), ["UPLOADED", "READY", "INVALID_FILE", "NEEDS_METADATA", "UPLOADING"]);

  const submitted: string[] = [];
  await runBatchUploadQueue({ items: retryCandidates, upload: async (item) => { submitted.push(item.localId); return { documentId: item.localId }; }, onStart: () => {}, onSuccess: () => {}, onFailure: () => {} });
  assert.deepEqual(submitted, [failed.localId]);
});

test("run guard makes duplicate Upload Ready activation a no-op while the first queue is active", async () => {
  const guard = createBatchUploadRunGuard();
  let releases!: () => void;
  const first = guard.run(() => new Promise<void>((resolve) => { releases = resolve; }));
  const second = await guard.run(async () => { throw new Error("must not run"); });
  assert.equal(second, false);
  releases();
  assert.equal(await first, true);
  let runs = 0;
  assert.equal(await guard.run(async () => { runs += 1; }), true);
  assert.equal(runs, 1);
});

test("bulk upload client uses the existing per-file endpoint and exposes accessible batch controls", async () => {
  const source = await readFile(new URL("../src/components/documents/batch-upload-review.tsx", import.meta.url), "utf8");
  assert.match(source, /type="file" multiple/);
  assert.match(source, /maximumBatchUploadFiles/);
  assert.match(source, /fetch\("\/api\/documents", \{ method: "POST", body: formData \}\)/);
  assert.match(source, /Upload ready files/);
  assert.match(source, /Retry failed/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /\/api\/documents\/batch/);
  assert.doesNotMatch(source, /drive_file_id|drive_folder_id|GOOGLE_DRIVE|refresh_token|client_secret/i);
});

test("queue implementation is a worker pool rather than a giant simultaneous request group", async () => {
  const source = await readFile(new URL("../src/lib/documents/batch-upload-queue.ts", import.meta.url), "utf8");
  assert.match(source, /while \(next < queue\.length\)/);
  assert.match(source, /Math\.min\(concurrency, queue\.length\)/);
  assert.doesNotMatch(source, /Promise\.all\(queue\.map/);
});

test("batch review and rows expose accessible multi-select, metadata, status, and removal controls", () => {
  const review = renderToStaticMarkup(React.createElement(BatchUploadReview, { categories: adminCategories, maxBytes: 4 * 1024 * 1024 }));
  assert.match(review, /type="file"[^>]*multiple/);
  assert.match(review, /Common defaults/);
  assert.match(review, /Select up to 25 approved files/);

  const item = ready("accessible");
  const row = renderToStaticMarkup(React.createElement("table", undefined, React.createElement("tbody", undefined, React.createElement(BatchUploadRow, { item, categories: adminCategories, checked: false, disabled: false, onSelect: () => {}, onChange: () => {}, onRemove: () => {} }))));
  for (const label of ["Select accessible.pdf", "Document number for accessible.pdf", "Subject for accessible.pdf", "Persons involved for accessible.pdf", "Document date for accessible.pdf", "Document type for accessible.pdf", "Filing year for accessible.pdf"]) assert.match(row, new RegExp(label));
  assert.match(row, /Ready/);
  assert.match(row, />Remove</);
});
