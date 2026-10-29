import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "../notifications/notification-service";

/**
 * Standard Records Disposition Schedule (RDS) mapping under NAP RA 9470 and COA guidelines.
 * Values indicate retention period in months.
 * 0 indicates permanent archival retention (not eligible for disposal).
 */
export const DEFAULT_RETENTION_SCHEDULE: Record<string, number> = {
  "BOARD RESOLUTION": 0, // Permanent
  "BOARD MEETING MINUTES": 0, // Permanent
  "ANNUAL REPORT": 0, // Permanent
  "OPERATIONS MANUAL": 0, // Permanent until superseded
  "REFERENCE & TEMPLATES": 0, // Permanent
  CONTRACTS: 120, // 10 years post-effectivity
  BAC: 120, // 10 years
  HRMO: 120, // 10 years
  MEMORANDUM: 60, // 5 years
  "OFFICE ORDER": 60, // 5 years
  "BACTI TEST": 60, // 5 years
  "GSIS / GSIS REQUEST": 60, // 5 years
  LETTER: 36, // 3 years
  ATTENDANCE: 36, // 3 years
  "OTHER DOCUMENTS": 60, // 5 years default
};

export function getRetentionPeriodMonths(documentType: string, overrideMonths?: number | null): number {
  if (overrideMonths !== undefined && overrideMonths !== null && overrideMonths >= 0) {
    return overrideMonths;
  }
  return DEFAULT_RETENTION_SCHEDULE[documentType] ?? 60;
}

export function isDocumentPermanent(documentType: string, overrideMonths?: number | null): boolean {
  return getRetentionPeriodMonths(documentType, overrideMonths) === 0;
}

export interface RetentionScanResult {
  evaluated: number;
  flaggedForReview: number;
  permanentRecords: number;
  errors: string[];
}

export async function scanRetentionEligibility(
  supabase: SupabaseClient,
  options?: {
    referenceDate?: Date;
  },
): Promise<RetentionScanResult> {
  const now = options?.referenceDate ?? new Date();
  const errors: string[] = [];
  let evaluated = 0;
  let flaggedForReview = 0;
  let permanentRecords = 0;

  // 1. Fetch active admin users for notifications
  const { data: adminUsers, error: adminsError } = await supabase
    .from("users")
    .select("id, email, name, role")
    .eq("status", "ACTIVE")
    .eq("role", "ADMIN");

  if (adminsError || !adminUsers) {
    throw new Error(`Failed to query admin users for retention: ${adminsError?.message}`);
  }

  // 2. Fetch documents currently ACTIVE in retention lifecycle
  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("document_id, document_type, document_number, document_date, subject, confidential, retention_period_months, retention_status")
    .eq("deletion_state", "ACTIVE")
    .eq("retention_status", "ACTIVE");

  if (docsError || !documents) {
    throw new Error(`Failed to query documents for retention: ${docsError?.message}`);
  }

  evaluated = documents.length;

  for (const doc of documents) {
    const periodMonths = getRetentionPeriodMonths(doc.document_type, doc.retention_period_months);
    if (periodMonths === 0) {
      permanentRecords++;
      continue;
    }

    const docDate = new Date(doc.document_date);
    if (isNaN(docDate.getTime())) {
      errors.push(`Invalid document_date on document ${doc.document_id}`);
      continue;
    }

    // Add periodMonths to document_date
    const expirationDate = new Date(docDate);
    expirationDate.setMonth(expirationDate.getMonth() + periodMonths);

    // If expirationDate <= now, flag for administrative review (never auto-dispose!)
    if (expirationDate.getTime() <= now.getTime()) {
      const { error: updateError } = await supabase
        .from("documents")
        .update({
          retention_status: "PENDING_REVIEW",
          retention_flagged_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("document_id", doc.document_id)
        .eq("retention_status", "ACTIVE");

      if (updateError) {
        errors.push(`Failed to flag document ${doc.document_id}: ${updateError.message}`);
        continue;
      }

      flaggedForReview++;

      // Notify administrators
      for (const admin of adminUsers) {
        try {
          await createNotification(supabase, {
            userId: admin.id,
            kind: "RETENTION_FLAGGED",
            documentId: doc.document_id,
            title: "Document Eligible for Retention Review",
            body: `Document "${doc.subject}" (${doc.document_number || doc.document_type}) has met its ${periodMonths}-month retention period and requires disposition review.`,
          });
        } catch (err) {
          errors.push(`Failed notification to admin ${admin.email}: ${err}`);
        }
      }
    }
  }

  return {
    evaluated,
    flaggedForReview,
    permanentRecords,
    errors,
  };
}

export async function approveRetentionAction(
  supabase: SupabaseClient,
  params: {
    actorId: string;
    documentId: string;
    action: "ARCHIVE" | "DISPOSE";
    notes?: string;
  },
): Promise<{
  document_id: string;
  retention_status: string;
  retention_approved_at: string;
  retention_approved_by: string;
  retention_notes: string;
}> {
  const { data, error } = await supabase.rpc("approve_retention_action", {
    p_actor_id: params.actorId,
    p_document_id: params.documentId,
    p_action: params.action,
    p_notes: params.notes ?? "",
  });

  if (error) {
    throw new Error(error.message || "APPROVE_RETENTION_FAILED");
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row;
}
