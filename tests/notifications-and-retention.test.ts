import assert from "node:assert/strict";
import test from "node:test";
import { addDocumentComment, listDocumentComments } from "../src/lib/comments/comment-service";
import {
  getUnreadNotificationCount,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sanitizeNotificationContent,
} from "../src/lib/notifications/notification-service";
import {
  REMINDER_THRESHOLDS,
  scanAndDispatchReminders,
} from "../src/lib/reminders/reminder-service";
import {
  getRetentionPeriodMonths,
  isDocumentPermanent,
  scanRetentionEligibility,
} from "../src/lib/retention/retention-service";

const dummyAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@kwd.gov.ph",
  name: "District Admin",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
};

const dummyStaff = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "staff@kwd.gov.ph",
  name: "Records Officer",
  role: "STAFF" as const,
  status: "ACTIVE" as const,
};

const dummyViewer = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "viewer@kwd.gov.ph",
  name: "Auditor Viewer",
  role: "VIEWER" as const,
  status: "ACTIVE" as const,
};

test("REMINDER_THRESHOLDS defines 90, 30, and 7 days", () => {
  assert.deepEqual(REMINDER_THRESHOLDS, [90, 30, 7]);
});

test("sanitizeNotificationContent prevents leaking confidential details to non-admins", () => {
  const title = "Expiration Alert: BOD-2026-CONF-001";
  const body = "Confidential Board Resolution regarding executive compensation is expiring.";

  // Non-admin receives sanitized placeholder
  const staffView = sanitizeNotificationContent(title, body, true, "STAFF");
  assert.equal(staffView.title, "Document Notification");
  assert.equal(
    staffView.body,
    "You have received an update regarding a restricted district record.",
  );

  // Admin receives genuine text
  const adminView = sanitizeNotificationContent(title, body, true, "ADMIN");
  assert.equal(adminView.title, title);
  assert.equal(adminView.body, body);

  // Non-confidential document passes unaltered to all roles
  const publicView = sanitizeNotificationContent("General Update", "Standard memo posted.", false, "STAFF");
  assert.equal(publicView.title, "General Update");
  assert.equal(publicView.body, "Standard memo posted.");
});

test("scanAndDispatchReminders enforces exactly-once reminder dispatch", async () => {
  const referenceDate = new Date("2026-06-01T00:00:00Z");

  // Document expiring in 25 days (within 30-day threshold, but after 7-day)
  const expiringDoc = {
    document_id: "doc-expiring-1",
    document_type: "CONTRACTS",
    document_number: "KWD-2026-CONTR-01",
    subject: "Water Supply Pipe Lease",
    confidential: false,
    created_by: "staff@kwd.gov.ph",
    expires_at: new Date("2026-06-26T00:00:00Z").toISOString(), // +25 days
    due_at: null,
  };

  interface FakeNotificationPayload {
    user_id: string;
    kind: string;
    document_id: string | null;
    title: string;
    body: string;
  }
  const fakeRemindersSent: { document_id: string; kind: string; threshold_days: number }[] = [];
  const fakeNotifications: FakeNotificationPayload[] = [];

  const fakeSupabase = {
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [dummyAdmin, dummyStaff], error: null }),
          }),
        };
      }
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              or: () => Promise.resolve({ data: [expiringDoc], error: null }),
            }),
          }),
        };
      }
      if (table === "reminders_sent") {
        return {
          insert: async (row: { document_id: string; kind: string; threshold_days: number }) => {
            const exists = fakeRemindersSent.some(
              (r) =>
                r.document_id === row.document_id &&
                r.kind === row.kind &&
                r.threshold_days === row.threshold_days,
            );
            if (exists) {
              return { error: { code: "23505", message: "unique constraint violation" } };
            }
            fakeRemindersSent.push(row);
            return { error: null };
          },
        };
      }
      if (table === "notifications") {
        return {
          insert: (row: FakeNotificationPayload) => ({
            select: () => ({
              single: () => {
                fakeNotifications.push(row);
                return Promise.resolve({ data: { id: "notif-1", ...row }, error: null });
              },
            }),
          }),
        };
      }
      return {};
    },
  };

  // First run: should trigger the 90-day and 30-day reminders (since 25 <= 90 and 25 <= 30)
  const firstRun = await scanAndDispatchReminders(fakeSupabase as never, { referenceDate });
  assert.equal(firstRun.documentsEvaluated, 1);
  assert.equal(firstRun.remindersTriggered, 2); // 90 and 30 threshold
  assert.equal(firstRun.errors.length, 0);
  assert.equal(fakeRemindersSent.length, 2);

  // Second run: exactly-once check prevents any new reminders from being sent
  const secondRun = await scanAndDispatchReminders(fakeSupabase as never, { referenceDate });
  assert.equal(secondRun.documentsEvaluated, 1);
  assert.equal(secondRun.remindersTriggered, 0); // Already sent, skipped
  assert.equal(fakeRemindersSent.length, 2);
});

test("retention service honors NAP RA 9470 disposition schedules and never auto-disposes", async () => {
  // Board resolutions are permanent (0 months)
  assert.equal(isDocumentPermanent("BOARD RESOLUTION"), true);
  assert.equal(getRetentionPeriodMonths("BOARD RESOLUTION"), 0);

  // Memorandums have a 60-month retention period
  assert.equal(isDocumentPermanent("MEMORANDUM"), false);
  assert.equal(getRetentionPeriodMonths("MEMORANDUM"), 60);

  // Contracts have 120-month retention period
  assert.equal(getRetentionPeriodMonths("CONTRACTS"), 120);

  const referenceDate = new Date("2026-10-01T00:00:00Z");

  // Document 1: 70 months old memorandum (eligible for review)
  // Document 2: 70 months old Board Resolution (permanent, never eligible)
  const docs = [
    {
      document_id: "doc-memo-old",
      document_type: "MEMORANDUM",
      document_number: "MEMO-2020-001",
      document_date: "2020-01-01", // > 60 months before 2026-10-01
      subject: "Old 2020 Administrative Directive",
      confidential: false,
      retention_period_months: null,
      retention_status: "ACTIVE",
    },
    {
      document_id: "doc-bod-old",
      document_type: "BOARD RESOLUTION",
      document_number: "BOD-2020-001",
      document_date: "2020-01-01",
      subject: "Permanent Board Resolution 2020",
      confidential: false,
      retention_period_months: 0, // Permanent
      retention_status: "ACTIVE",
    },
  ];

  const updatedRecords: Record<string, string> = {};
  const fakeNotifications: FakeNotificationPayload[] = [];

  const fakeSupabase = {
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [dummyAdmin], error: null }),
            }),
          }),
        };
      }
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: docs, error: null }),
            }),
          }),
          update: (fields: { retention_status: string }) => ({
            eq: (col1: string, val1: string) => ({
              eq: () => {
                updatedRecords[val1] = fields.retention_status;
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: (row: FakeNotificationPayload) => ({
            select: () => ({
              single: () => {
                fakeNotifications.push(row);
                return Promise.resolve({ data: { id: "notif-ret-1", ...row }, error: null });
              },
            }),
          }),
        };
      }
      return {};
    },
  };

  const result = await scanRetentionEligibility(fakeSupabase as never, { referenceDate });

  assert.equal(result.evaluated, 2);
  assert.equal(result.permanentRecords, 1);
  assert.equal(result.flaggedForReview, 1);
  assert.equal(result.errors.length, 0);

  // The memorandum was transitioned to PENDING_REVIEW (flagged, NOT deleted/disposed)
  assert.equal(updatedRecords["doc-memo-old"], "PENDING_REVIEW");
  assert.equal(updatedRecords["doc-bod-old"], undefined); // Permanent resolution untouched

  // Admin was notified of retention review eligibility
  assert.equal(fakeNotifications.length, 1);
  assert.equal(fakeNotifications[0].kind, "RETENTION_FLAGGED");
});

test("document comments enforce can_read_document and validation", async () => {
  // 1. Content validation
  await assert.rejects(
    async () => {
      await addDocumentComment({} as never, dummyStaff, "doc-1", "");
    },
    { message: /between 1 and 2000/ },
  );

  await assert.rejects(
    async () => {
      await addDocumentComment({} as never, dummyStaff, "doc-1", "a".repeat(2001));
    },
    { message: /between 1 and 2000/ },
  );

  // 2. Successful comment via RPC
  const fakeRpcSupabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "add_document_comment") {
        return {
          data: [
            {
              id: "comment-1",
              document_id: args.p_document_id,
              user_id: args.p_actor_id,
              user_name: dummyStaff.name,
              user_email: dummyStaff.email,
              user_role: dummyStaff.role,
              content: args.p_content,
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  const created = await addDocumentComment(fakeRpcSupabase as never, dummyStaff, "doc-1", "Valid compliance comment");
  assert.equal(created.id, "comment-1");
  assert.equal(created.content, "Valid compliance comment");
  assert.equal(created.user_name, dummyStaff.name);

  // 3. Confidential document masking on listing comments
  const fakeQuerySupabase = {
    from: (table: string) => {
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    document_id: "doc-conf",
                    deletion_state: "ACTIVE",
                    confidential: true,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    },
  };

  // Staff and Viewer cannot read comments on confidential documents
  const viewerComments = await listDocumentComments(fakeQuerySupabase as never, dummyViewer, "doc-conf");
  assert.deepEqual(viewerComments, []);

  const staffComments = await listDocumentComments(fakeQuerySupabase as never, dummyStaff, "doc-conf");
  assert.deepEqual(staffComments, []);
});

test("notifications API operations: create, list, mark read, and unread count", async () => {
  const notifStore = [
    {
      id: "n-1",
      user_id: dummyStaff.id,
      kind: "REMINDER_30",
      document_id: "doc-1",
      title: "Contract Expiring",
      body: "Contract expires in 30 days.",
      read_at: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "n-2",
      user_id: dummyStaff.id,
      kind: "COMMENT",
      document_id: "doc-1",
      title: "New Comment",
      body: "Staff added a comment.",
      read_at: new Date().toISOString(), // already read
      created_at: new Date().toISOString(),
    },
  ];

  const fakeSupabase = {
    from: (table: string) => {
      if (table === "notifications") {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            let filtered = [...notifStore];
            return {
              eq: (_col: string, val: string) => {
                filtered = filtered.filter((n) => n.user_id === val);
                return {
                  is: () => {
                    filtered = filtered.filter((n) => n.read_at === null);
                    if (opts?.head) {
                      return Promise.resolve({ count: filtered.length, error: null });
                    }
                    return Promise.resolve({ data: filtered, count: filtered.length, error: null });
                  },
                  order: () => ({
                    range: (from: number, to: number) => {
                      return Promise.resolve({
                        data: filtered.slice(from, to + 1),
                        count: filtered.length,
                        error: null,
                      });
                    },
                  }),
                };
              },
            };
          },
          update: (fields: { read_at: string }) => ({
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: string) => {
                const target = notifStore.find((n) => n.id === val1 && n.user_id === val2);
                if (target) target.read_at = fields.read_at;
                return Promise.resolve({ error: null });
              },
              is: () => {
                const updated: typeof notifStore = [];
                for (const item of notifStore) {
                  if (item.user_id === val1 && !item.read_at) {
                    item.read_at = fields.read_at;
                    updated.push(item);
                  }
                }
                return {
                  select: () => Promise.resolve({ data: updated, error: null }),
                };
              },
            }),
          }),
        };
      }
      return {};
    },
  };

  const count = await getUnreadNotificationCount(fakeSupabase as never, dummyStaff.id);
  assert.equal(count, 1);

  const list = await listUserNotifications(fakeSupabase as never, dummyStaff.id);
  assert.equal(list.total, 2);
  assert.equal(list.unreadCount, 1);

  const marked = await markNotificationRead(fakeSupabase as never, dummyStaff.id, "n-1");
  assert.equal(marked, true);
  assert.ok(notifStore[0].read_at !== null);

  const allCount = await markAllNotificationsRead(fakeSupabase as never, dummyStaff.id);
  assert.equal(allCount, 0); // None left unread
});
