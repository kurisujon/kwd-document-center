import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedUser } from "../auth/types";
import { documentColumns } from "../documents/repository";
import type { DocumentRecord } from "../documents/types";

export interface DashboardMetrics {
  totalDocuments: number;
  expiringSoonCount: number;
  pendingRetentionCount: number;
  typeCounts: Record<string, number>;
  recentUploads: DocumentRecord[];
  expiringDocuments: DocumentRecord[];
}

export async function getDashboardMetrics(
  supabase: SupabaseClient,
  user: AuthorizedUser,
): Promise<DashboardMetrics> {
  const isAdmin = user.role === "ADMIN";

  // 1. RPC for aggregate counts (or query)
  let totalDocuments = 0;
  let expiringSoonCount = 0;
  let pendingRetentionCount = 0;
  let typeCounts: Record<string, number> = {};

  try {
    const { data, error } = await supabase.rpc("get_dashboard_summary", {
      p_actor_id: user.id,
    });
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      totalDocuments = Number(row.total_documents || 0);
      expiringSoonCount = Number(row.expiring_soon_count || 0);
      pendingRetentionCount = Number(row.pending_retention_count || 0);
      typeCounts = (row.type_counts || {}) as Record<string, number>;
    }
  } catch {
    // Fallback via direct query
  }

  // 2. Recent uploads query (top 5 accessible)
  let recentQuery = supabase
    .from("documents")
    .select(documentColumns)
    .eq("deletion_state", "ACTIVE");

  if (!isAdmin) {
    recentQuery = recentQuery.eq("confidential", false);
  }

  const { data: recentData } = await recentQuery
    .order("created_at", { ascending: false })
    .limit(5);
  const recentUploads = (recentData ?? []) as DocumentRecord[];

  // 3. Upcoming expiring documents query (top 5 accessible, expiring in the future)
  const nowIso = new Date().toISOString();
  let expiringQuery = supabase
    .from("documents")
    .select(documentColumns)
    .eq("deletion_state", "ACTIVE")
    .gte("expires_at", nowIso);

  if (!isAdmin) {
    expiringQuery = expiringQuery.eq("confidential", false);
  }

  const { data: expiringData } = await expiringQuery
    .order("expires_at", { ascending: true })
    .limit(5);
  const expiringDocuments = (expiringData ?? []) as DocumentRecord[];

  return {
    totalDocuments,
    expiringSoonCount,
    pendingRetentionCount,
    typeCounts,
    recentUploads,
    expiringDocuments,
  };
}
