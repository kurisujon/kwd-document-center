import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../auth/types";
import { canReadDocument } from "../auth/permissions";
import type { DocumentRecord } from "../documents/types";

export interface SearchHit {
  document: DocumentRecord;
  snippet?: string;
  rank?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}

/**
 * Generates an excerpt snippet with matched words bolded (<b>...</b>)
 * using a case-insensitive window around the matched search terms.
 */
export function generateSnippet(
  text: string,
  query: string,
): string {
  if (!text || !query) return "";
  const cleanQuery = query.trim();
  if (!cleanQuery) return "";

  const words = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const lowerText = text.toLowerCase();
  let firstMatchIndex = -1;
  for (const word of words) {
    const idx = lowerText.indexOf(word);
    if (idx !== -1 && (firstMatchIndex === -1 || idx < firstMatchIndex)) {
      firstMatchIndex = idx;
    }
  }

  if (firstMatchIndex === -1) {
    // Return the beginning if no exact match found
    const prefix = text.slice(0, 160).trim();
    return prefix.length < text.length ? `${prefix}...` : prefix;
  }

  // Calculate word boundaries around the first match
  const startChar = Math.max(0, firstMatchIndex - 80);
  const endChar = Math.min(text.length, firstMatchIndex + 140);
  let snippet = text.slice(startChar, endChar);

  if (startChar > 0) snippet = `...${snippet}`;
  if (endChar < text.length) snippet = `${snippet}...`;

  // Highlight matched terms
  for (const word of words) {
    const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    snippet = snippet.replace(regex, "<b>$1</b>");
  }

  return snippet;
}

/**
 * Searches documents across metadata and extracted full-text content.
 * Strictly guarantees that confidential documents are NEVER visible to non-admin users.
 */
export async function searchDocuments(
  supabase: SupabaseClient,
  input: {
    query: string;
    page?: number;
    pageSize?: number;
  },
  viewer?: { role: Role; status?: "ACTIVE" | "INACTIVE"; email?: string },
): Promise<SearchResult> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const cleanQuery = input.query.trim();

  if (!cleanQuery) {
    return { hits: [], total: 0, page, pageSize, query: "" };
  }

  if (viewer?.status && viewer.status !== "ACTIVE") {
    return { hits: [], total: 0, page, pageSize, query: cleanQuery };
  }

  const userEmail = viewer?.email ?? "";
  const { data, error } = await supabase.rpc("search_documents_fulltext", {
    p_query: cleanQuery,
    p_user_email: userEmail,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error || !data) {
    return { hits: [], total: 0, page, pageSize, query: cleanQuery };
  }

  const rawRows = (Array.isArray(data) ? data : []) as Array<{
    document_id: string;
    document_type: string;
    document_number: string | null;
    document_date: string;
    subject: string;
    status: string;
    confidential: boolean;
    file_name: string | null;
    snippet: string | null;
    rank: number;
    total_count: string | number;
  }>;

  // Enforce server-side permissions check on every returned record
  const filteredRows = rawRows.filter((row) => {
    if (!viewer) return true;
    return canReadDocument(viewer, {
      confidential: row.confidential,
      deletion_state: "ACTIVE",
    });
  });

  const total = rawRows.length > 0 ? Number(rawRows[0]!.total_count) : 0;
  const hits: SearchHit[] = filteredRows.map((row) => ({
    document: {
      document_id: row.document_id,
      document_type: row.document_type,
      document_number: row.document_number,
      document_date: row.document_date,
      subject: row.subject,
      persons_involved: null,
      drive_file_id: null,
      drive_url: null,
      file_name: row.file_name,
      file_type: null,
      filing_year: null,
      filing_subcategory: null,
      status: row.status as never,
      confidential: row.confidential,
      created_by: null,
      created_at: "",
      updated_at: "",
    },
    snippet: row.snippet ?? undefined,
    rank: row.rank,
  }));

  return { hits, total, page, pageSize, query: cleanQuery };
}
