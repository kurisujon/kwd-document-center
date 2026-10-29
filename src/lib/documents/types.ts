export const documentSortFields = [
  "document_number",
  "document_type",
  "document_date",
  "subject",
  "created_at",
] as const;

export type DocumentSortField = (typeof documentSortFields)[number];
export type SortOrder = "asc" | "desc";
export type DocumentDeletionState = "ACTIVE" | "DELETE_PENDING" | "DELETED" | "DELETE_FAILED";

export type DocumentStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED";
export type DocumentRelation = "RELATES_TO" | "SUPERSEDES" | "AMENDS";
export type RetentionStatus = "ACTIVE" | "PENDING_REVIEW" | "ARCHIVED" | "DISPOSED";

export interface DocumentRecord {
  document_id: string;
  document_type: string;
  document_number: string | null;
  document_date: string;
  subject: string;
  persons_involved: string | null;
  drive_file_id: string | null;
  drive_url: string | null;
  file_name: string | null;
  file_type: string | null;
  filing_year: number | null;
  filing_subcategory: string | null;
  status: DocumentStatus;
  deletion_state?: DocumentDeletionState;
  confidential?: boolean;
  custom_metadata?: Record<string, unknown>;
  file_sha256?: string | null;
  version_count?: number;
  expires_at?: string | null;
  due_at?: string | null;
  retention_period_months?: number | null;
  retention_status?: RetentionStatus;
  retention_flagged_at?: string | null;
  retention_approved_at?: string | null;
  retention_approved_by?: string | null;
  retention_notes?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentCommentRecord {
  id: string;
  document_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  content: string;
  created_at: string;
}

export interface DocumentLinkRecord {
  id: string;
  from_id: string;
  to_id: string;
  relation: DocumentRelation;
  created_by: string;
  created_at: string;
  target_document?: {
    document_id: string;
    document_type: string;
    document_number: string | null;
    subject: string;
    confidential?: boolean;
  };
}

export interface DocumentVersionRecord {
  id: string;
  document_id: string;
  version_number: number;
  drive_file_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_sha256: string;
  change_summary: string;
  created_by: string;
  created_at: string;
}

export interface TagRecord {
  id: string;
  name: string;
  color: string;
  created_by?: string | null;
  created_at: string;
}

export interface SavedFilterRecord {
  id: string;
  user_id: string;
  name: string;
  query_params: Record<string, unknown>;
  created_at: string;
}

export interface DocumentListQuery {
  q?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sortBy: DocumentSortField;
  sortOrder: SortOrder;
  customFilters?: Record<string, string>;
}

export interface PaginatedDocuments {
  documents: DocumentRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export type ApprovalStepStatus = "PENDING" | "IN_PROGRESS" | "APPROVED" | "RETURNED";

export interface ApprovalRouteTemplate {
  id: string;
  document_type: string;
  name: string;
  description: string | null;
  steps: Array<{
    step_number: number;
    title: string;
    role: "STAFF" | "ADMIN";
    approver_id?: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface DocumentApprovalStepRecord {
  id: string;
  document_id: string;
  step_number: number;
  title: string;
  approver_id: string | null;
  approver_role: "STAFF" | "ADMIN";
  status: ApprovalStepStatus;
  notes: string | null;
  action_at: string | null;
  action_by: string | null;
  created_at: string;
}

export interface ApprovalTaskRecord {
  step_id: string;
  document_id: string;
  step_number: number;
  step_title: string;
  step_status: ApprovalStepStatus;
  approver_id: string | null;
  approver_role: "STAFF" | "ADMIN";
  document_number: string | null;
  document_type: string;
  subject: string;
  confidential: boolean;
  file_name: string | null;
  file_type: string | null;
  document_status: DocumentStatus;
  created_at: string;
}
