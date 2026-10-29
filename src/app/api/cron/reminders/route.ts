import { protectedJson } from "@/lib/http/response";
import { scanAndDispatchReminders } from "@/lib/reminders/reminder-service";
import { scanRetentionEligibility } from "@/lib/retention/retention-service";
import { createAdminClient } from "@/lib/supabase/admin";

function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // If not configured, allow in non-production environments for local testing
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  return token === cronSecret;
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

async function handleCron(request: Request) {
  if (!isCronAuthorized(request)) {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Invalid or missing CRON_SECRET." } }, 401);
  }

  try {
    const adminClient = createAdminClient();

    const [reminderResult, retentionResult] = await Promise.all([
      scanAndDispatchReminders(adminClient),
      scanRetentionEligibility(adminClient),
    ]);

    return protectedJson({
      success: true,
      timestamp: new Date().toISOString(),
      reminders: reminderResult,
      retention: retentionResult,
    });
  } catch (err) {
    return protectedJson(
      {
        error: {
          code: "CRON_EXECUTION_FAILED",
          message: err instanceof Error ? err.message : "Cron execution encountered an error.",
        },
      },
      500,
    );
  }
}
