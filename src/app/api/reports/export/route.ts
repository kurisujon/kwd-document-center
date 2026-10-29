import { getAuthorization } from "@/lib/auth/server";
import { protectedJson } from "@/lib/http/response";
import { fetchReportDocuments, generateDocumentsCsv, type ReportFilterOptions } from "@/lib/reports/report-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || undefined;
  const yearStr = url.searchParams.get("year");
  const year = yearStr && /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : undefined;
  const subcategory = url.searchParams.get("subcategory") || undefined;
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const retentionStatus = url.searchParams.get("retentionStatus") || undefined;

  const filters: ReportFilterOptions = {
    type,
    year,
    subcategory,
    dateFrom,
    dateTo,
    status,
    retentionStatus,
  };

  try {
    const supabase = await createClient();
    const documents = await fetchReportDocuments(supabase, filters, authorization.user);
    const csvContent = generateDocumentsCsv(documents);

    // Audit log entry for report export
    try {
      const adminClient = createAdminClient();
      await adminClient.from("audit_log").insert({
        actor_id: authorization.user.id,
        actor_email: authorization.user.email,
        action: "REPORT_EXPORT_CSV",
        entity_type: "DOCUMENT",
        entity_id: "REPORTS_EXPORT",
        metadata: {
          filters,
          record_count: documents.length,
        },
      });
    } catch {
      // Non-fatal if direct insert fails in testing
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const filename = `kwd-documents-report-${todayStr}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    return protectedJson(
      { error: { code: "EXPORT_FAILED", message: err instanceof Error ? err.message : "Failed to generate report export." } },
      500,
    );
  }
}
