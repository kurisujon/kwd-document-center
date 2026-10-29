# ADR-010: Notifications, Scheduled Reminders, Legal Retention Lifecycle, and Document Comments

## Context and Problem Statement

KWD Document Center requires records management workflows beyond passive storage:
1. **Notifications & Reminders:** Tracking critical document milestones such as contract expirations, permit/license renewals, and compliance due dates with alerts at 90, 30, and 7 days.
2. **Exactly-Once Reminders:** Reminders must not spam users or duplicate across periodic cron scans.
3. **Legal Records Retention (NAP RA 9470 & COA):** As a government-owned and controlled water district, Kiblawan Water District's records disposition is legally governed by the National Archives of the Philippines (NAP) under Republic Act No. 9470 and Commission on Audit (COA) circulars. The system must never automatically destroy or dispose of documents.
4. **Document Comments:** Enabling collaborative notes and compliance discussions directly on document records.
5. **Confidentiality:** Confidential documents must never leak details (such as subject, number, or parties) in notification titles, bodies, emails, or comments to unauthorized users.

## Decisions

### 1. In-App Notifications and Pluggable Email Dispatch
- In-app notifications are stored in `public.notifications` with Row Level Security (RLS) restricting reads and updates to the recipient user.
- Email delivery is modeled via a clean, decoupled `EmailDispatcher` interface. In accordance with project security rules against unapproved npm dependencies, email dispatch currently formats standard structured logs in test/development and connects cleanly to environment-configured SMTP or webhook endpoints without third-party libraries.
- The UI provides an in-app `/notifications` center and notification markers in the navigation header.

### 2. Scheduled Reminders & Vercel Cron
- Due dates and expiration dates are stored in `public.documents.due_at` and `public.documents.expires_at`.
- Thresholds are set at **90, 30, and 7 days** before expiration or compliance due date.
- Since Vercel Cron on the Hobby tier runs at most once per day, a daily cron job (`/api/cron/reminders`) provides the required frequency for 90/30/7-day threshold intervals.
- **Exactly-Once Delivery:** Enforced by the `public.reminders_sent` table with a database unique constraint `unique (document_id, kind, threshold_days)`. When a threshold is met, the reminder record is written atomically with the notification dispatch, preventing duplicate alerts across subsequent cron runs.

### 3. Legal Retention Lifecycle (No Auto-Disposal)
- Retention periods in months (`retention_period_months`) are mapped to KWD's approved Records Disposition Schedule (RDS) based on NAP guidelines (e.g., Board Resolutions = permanent; Memorandums = 60 months; Contracts = 120 months; Financial vouchers = 120 months).
- The system periodically evaluates records against their disposition date (`document_date + retention_period_months`).
- When a document reaches eligibility, the system transitions `retention_status` from `'ACTIVE'` to `'PENDING_REVIEW'` and notifies administrators. **The system NEVER automatically disposes of or deletes records.**
- Actual disposal or archiving requires an explicit administrative review and recorded approval (`approve_retention_action` RPC), requiring reason/notes and recording immutable entries (`DOCUMENT_RETENTION_FLAG`, `DOCUMENT_RETENTION_APPROVE`) in the append-only `audit_log`.

### 4. Document Comments
- Comments are persisted in `public.document_comments` referencing `public.documents(document_id)` and `public.users(id)`.
- RLS and server RPCs strictly enforce `public.can_read_document` so that users without access to confidential documents cannot read or insert comments.
- Comment additions write `DOCUMENT_COMMENT_CREATE` entries to `audit_log`.

### 5. Confidentiality Enforcement
- When generating notifications or emails for confidential documents:
  - If the document is marked `confidential = true`, notifications are sent **only to ACTIVE ADMINs**.
  - Notification titles and previews use sanitized text that does not leak confidential titles or subjects to any external or unauthorized context.
  - All comment access checks invoke `can_read_document`.

## Consequences
- **Positive:** Full compliance with Philippine records management laws (RA 9470) and COA requirements; zero auto-deletion accidents; robust exactly-once reminders; collaborative communication within document context.
- **Negative:** Requires administrators to periodically review and approve flagged retention records rather than relying on automatic cleanup.
