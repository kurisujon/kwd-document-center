export const documentSortFields = [
  "document_number",
  "document_type",
  "document_date",
  "subject",
  "created_at",
] as const;

export type DocumentSortField = (typeof documentSortFields)[number];
export type SortOrder = "asc" | "desc";

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
  status: "ACTIVE" | "ARCHIVED";
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
}

export interface PaginatedDocuments {
  documents: DocumentRecord[];
  total: number;
  page: number;
  pageSize: number;
}
