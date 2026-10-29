import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadDocument, hasMinimumRole } from "../auth/permissions";
import type { AuthorizedUser } from "../auth/types";
import type {
  ApprovalRouteTemplate,
  ApprovalTaskRecord,
  DocumentApprovalStepRecord,
} from "../documents/types";

export interface ProcessApprovalDecisionResult {
  id: string;
  document_id: string;
  step_number: number;
  title: string;
  status: string;
  notes: string;
  document_status: string;
  is_completed: boolean;
}

export async function getApprovalRoutes(
  supabase: SupabaseClient,
): Promise<ApprovalRouteTemplate[]> {
  const { data, error } = await supabase
    .from("approval_routes")
    .select("id, document_type, name, description, steps, created_at, updated_at")
    .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as ApprovalRouteTemplate[];
}

export async function getApprovalRouteForType(
  supabase: SupabaseClient,
  documentType: string,
): Promise<ApprovalRouteTemplate | null> {
  const { data, error } = await supabase
    .from("approval_routes")
    .select("id, document_type, name, description, steps, created_at, updated_at")
    .eq("document_type", documentType)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as ApprovalRouteTemplate;
}

export async function getDocumentApprovalSteps(
  supabase: SupabaseClient,
  actor: AuthorizedUser,
  documentId: string,
): Promise<DocumentApprovalStepRecord[]> {
  // Enforce document confidentiality and visibility
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("document_id, deletion_state, confidential")
    .eq("document_id", documentId)
    .maybeSingle();

  if (docError || !doc) {
    return [];
  }

  if (!canReadDocument(actor, doc)) {
    return [];
  }

  const { data, error } = await supabase
    .from("document_approval_steps")
    .select(
      "id, document_id, step_number, title, approver_id, approver_role, status, notes, action_at, action_by, created_at",
    )
    .eq("document_id", documentId)
    .order("step_number", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as DocumentApprovalStepRecord[];
}

export async function startDocumentApproval(
  supabase: SupabaseClient,
  actor: AuthorizedUser,
  documentId: string,
  customSteps?: Array<{
    step_number: number;
    title: string;
    role: "STAFF" | "ADMIN";
    approver_id?: string;
  }>,
): Promise<DocumentApprovalStepRecord[]> {
  if (!hasMinimumRole(actor.role, "STAFF")) {
    throw new Error("Only Staff and Administrators may initiate an approval route.");
  }

  const { data, error } = await supabase.rpc("start_document_approval", {
    p_actor_id: actor.id,
    p_document_id: documentId,
    p_custom_steps: customSteps && customSteps.length > 0 ? customSteps : null,
  });

  if (error) {
    throw new Error(error.message || "FAILED_TO_START_APPROVAL");
  }

  return (Array.isArray(data) ? data : []) as DocumentApprovalStepRecord[];
}

export async function processApprovalDecision(
  supabase: SupabaseClient,
  actor: AuthorizedUser,
  stepId: string,
  action: "APPROVE" | "RETURN",
  notes?: string,
): Promise<ProcessApprovalDecisionResult> {
  if (!hasMinimumRole(actor.role, "STAFF")) {
    throw new Error("Only Staff and Administrators can perform approval actions.");
  }

  if (action !== "APPROVE" && action !== "RETURN") {
    throw new Error("Invalid action. Must be APPROVE or RETURN.");
  }

  const { data, error } = await supabase.rpc("process_approval_action", {
    p_actor_id: actor.id,
    p_step_id: stepId,
    p_action: action,
    p_notes: notes || "",
  });

  if (error) {
    throw new Error(error.message || "FAILED_TO_PROCESS_APPROVAL_ACTION");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("APPROVAL_ACTION_NO_DATA_RETURNED");
  }

  return row as ProcessApprovalDecisionResult;
}

export async function listUserPendingTasks(
  supabase: SupabaseClient,
  actor: AuthorizedUser,
): Promise<ApprovalTaskRecord[]> {
  if (!hasMinimumRole(actor.role, "STAFF")) {
    return [];
  }

  const { data, error } = await supabase.rpc("get_user_approval_tasks", {
    p_actor_id: actor.id,
  });

  if (error || !data) {
    return [];
  }

  // Filter with canReadDocument defensively
  const tasks = (data as ApprovalTaskRecord[]).filter((task) =>
    canReadDocument(actor, {
      deletion_state: "ACTIVE",
      confidential: task.confidential,
    }),
  );

  return tasks;
}
