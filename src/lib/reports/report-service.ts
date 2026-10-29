import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedUser } from "../auth/types";
import { documentColumns } from "../documents/repository";
import type { DocumentRecord } from "../documents/types";

export interface ReportFilterOptions {
  type?: string;
  year?: number;
  subcategory?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  retentionStatus?: string;
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  // If field contains comma, quote, or newline, escape internal quotes by doubling them
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateDocumentsCsv(documents: DocumentRecord[]): string {
  const headers = [
    "Document Number",
    "Document Type",
    "Filing Year",
    "Subcategory",
    "Document Date",
    "Subject",
    "Persons Involved",
    "Status",
    "Retention Status",
    "Expiration Date",
    "Due Date",
    "File Name",
    "Uploaded By",
    "Created At",
  ];

  const rows: string[] = [headers.map(escapeCsvField).join(",")];

  for (const doc of documents) {
    const row = [
      doc.document_number,
      doc.document_type,
      doc.filing_year,
      doc.filing_subcategory,
      doc.document_date,
      doc.subject,
      doc.persons_involved,
      doc.status,
      doc.retention_status ?? "ACTIVE",
      doc.expires_at ? doc.expires_at.split("T")[0] : "",
      doc.due_at ? doc.due_at.split("T")[0] : "",
      doc.file_name,
      doc.created_by,
      doc.created_at ? doc.created_at.split("T")[0] : "",
    ];
    rows.push(row.map(escapeCsvField).join(","));
  }

  return rows.join("\r\n");
}

export async function fetchReportDocuments(
  supabase: SupabaseClient,
  filters: ReportFilterOptions,
  user: AuthorizedUser,
): Promise<DocumentRecord[]> {
  let query = supabase
    .from("documents")
    .select(documentColumns)
    .eq("deletion_state", "ACTIVE");

  if (user.role !== "ADMIN") {
    query = query.eq("confidential", false);
  }

  if (filters.type) query = query.eq("document_type", filters.type);
  if (filters.year) query = query.eq("filing_year", filters.year);
  if (filters.subcategory) query = query.eq("filing_subcategory", filters.subcategory);
  if (filters.dateFrom) query = query.gte("document_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("document_date", filters.dateTo);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.retentionStatus) query = query.eq("retention_status", filters.retentionStatus);

  query = query.order("document_date", { ascending: false });

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to query report records: ${error.message}`);
  }

  return (data ?? []) as DocumentRecord[];
}
