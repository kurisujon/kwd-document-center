import { listUserPendingTasks } from "@/lib/approvals/approval-service";
import { getAuthorization } from "@/lib/auth/server";
import { protectedJson } from "@/lib/http/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }

  try {
    const adminClient = createAdminClient();
    const tasks = await listUserPendingTasks(adminClient, authorization.user);
    return protectedJson({ tasks });
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to load tasks." } },
      500,
    );
  }
}
