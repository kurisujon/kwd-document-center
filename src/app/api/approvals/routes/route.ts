import { getApprovalRoutes } from "@/lib/approvals/approval-service";
import { getAuthorization } from "@/lib/auth/server";
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
    const routes = await getApprovalRoutes(supabase);
    return protectedJson({ routes });
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to load approval routes." } },
      500,
    );
  }
}
