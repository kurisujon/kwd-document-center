import { getAuthorization } from "@/lib/auth/server";
import { getDashboardMetrics } from "@/lib/dashboard/dashboard-service";
import { protectedJson } from "@/lib/http/response";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }

  try {
    const supabase = await createClient();
    const metrics = await getDashboardMetrics(supabase, authorization.user);
    return protectedJson(metrics);
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to load dashboard metrics." } },
      500,
    );
  }
}
