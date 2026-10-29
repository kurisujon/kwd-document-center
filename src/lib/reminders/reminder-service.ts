import type { SupabaseClient } from "@supabase/supabase-js";
import { emailDispatcher } from "../email/email-dispatcher";
import { createNotification, sanitizeNotificationContent, type NotificationKind } from "../notifications/notification-service";

export const REMINDER_THRESHOLDS = [90, 30, 7] as const;
export type ReminderThreshold = (typeof REMINDER_THRESHOLDS)[number];
export type ReminderKind = "EXPIRY" | "DUE_DATE";

export interface ReminderScanResult {
  documentsEvaluated: number;
  remindersTriggered: number;
  errors: string[];
}

export async function scanAndDispatchReminders(
  supabase: SupabaseClient,
  options?: {
    referenceDate?: Date;
  },
): Promise<ReminderScanResult> {
  const now = options?.referenceDate ?? new Date();
  const errors: string[] = [];
  let documentsEvaluated = 0;
  let remindersTriggered = 0;

  // 1. Fetch active users (to resolve admins and notification targets)
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("id, email, name, role, status")
    .eq("status", "ACTIVE");

  if (usersError || !usersData) {
    throw new Error(`Failed to query active users for reminders: ${usersError?.message}`);
  }

  const activeAdmins = usersData.filter((u) => u.role === "ADMIN");
  const usersByEmail = new Map(usersData.map((u) => [u.email.toLowerCase(), u]));

  // 2. Query active documents with either expires_at or due_at set
  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("document_id, document_type, document_number, subject, confidential, created_by, expires_at, due_at")
    .eq("deletion_state", "ACTIVE")
    .or("expires_at.not.is.null,due_at.not.is.null");

  if (docsError || !documents) {
    throw new Error(`Failed to query documents for reminders: ${docsError?.message}`);
  }

  documentsEvaluated = documents.length;

  for (const doc of documents) {
    const checks: { kind: ReminderKind; dateStr: string | null }[] = [
      { kind: "EXPIRY", dateStr: doc.expires_at },
      { kind: "DUE_DATE", dateStr: doc.due_at },
    ];

    for (const check of checks) {
      if (!check.dateStr) continue;

      const targetDate = new Date(check.dateStr);
      const diffMs = targetDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Check each threshold: 90, 30, 7
      for (const threshold of REMINDER_THRESHOLDS) {
        if (daysRemaining <= threshold && daysRemaining >= 0) {
          // Attempt atomic insertion into reminders_sent
          const { error: insertError } = await supabase.from("reminders_sent").insert({
            document_id: doc.document_id,
            kind: check.kind,
            threshold_days: threshold,
            sent_at: now.toISOString(),
          });

          if (insertError) {
            // If duplicate (already sent for this threshold), skip gracefully
            if (insertError.code === "23505" || insertError.message.includes("unique")) {
              continue;
            }
            errors.push(`Error inserting reminder for doc ${doc.document_id} (${threshold}d): ${insertError.message}`);
            continue;
          }

          remindersTriggered++;

          // Determine recipients:
          // Confidential docs go ONLY to admins. Non-confidential docs go to admins + uploader.
          const recipients = [...activeAdmins];
          if (!doc.confidential && doc.created_by) {
            const uploader = usersByEmail.get(doc.created_by.toLowerCase());
            if (uploader && !recipients.some((r) => r.id === uploader.id)) {
              recipients.push(uploader);
            }
          }

          const notifKind: NotificationKind = `REMINDER_${threshold}` as NotificationKind;
          const isExpiry = check.kind === "EXPIRY";
          const baseTitle = `${threshold}-Day ${isExpiry ? "Expiration" : "Due Date"} Reminder`;
          const baseBody = `Document "${doc.subject}" (${doc.document_number || doc.document_type}) is due in ${daysRemaining} day(s).`;

          for (const recipient of recipients) {
            const sanitized = sanitizeNotificationContent(
              baseTitle,
              baseBody,
              Boolean(doc.confidential),
              recipient.role as "ADMIN" | "STAFF" | "VIEWER",
            );

            // In-app notification
            try {
              await createNotification(supabase, {
                userId: recipient.id,
                kind: notifKind,
                documentId: doc.document_id,
                title: sanitized.title,
                body: sanitized.body,
              });
            } catch (err) {
              errors.push(`Failed in-app notification for ${recipient.email}: ${err}`);
            }

            // Email dispatch
            try {
              await emailDispatcher.sendEmail({
                to: recipient.email,
                subject: `[KWD Document Center] ${sanitized.title}`,
                text: sanitized.body,
              });
            } catch (err) {
              errors.push(`Failed email dispatch for ${recipient.email}: ${err}`);
            }
          }
        }
      }
    }
  }

  return {
    documentsEvaluated,
    remindersTriggered,
    errors,
  };
}
