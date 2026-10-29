import { z } from "zod";
import { getAuthorization } from "@/lib/auth/server";
import { isSameOrigin } from "@/lib/http/origin";
import { protectedJson } from "@/lib/http/response";
import {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/notification-service";
import { createClient } from "@/lib/supabase/server";

const patchNotificationSchema = z
  .object({
    notificationId: z.string().uuid().optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => data.notificationId || data.all, {
    message: "Either notificationId or all: true must be provided.",
  });

export async function GET(request: Request) {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1" || url.searchParams.get("unreadOnly") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;

  try {
    const supabase = await createClient();
    const result = await listUserNotifications(supabase, authorization.user.id, {
      unreadOnly,
      limit,
    });
    return protectedJson(result);
  } catch (err) {
    return protectedJson(
      { error: { code: "QUERY_FAILED", message: err instanceof Error ? err.message : "Failed to load notifications." } },
      500,
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = await getAuthorization();
  if (authorization.kind === "unauthenticated") {
    return protectedJson({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, 401);
  }
  if (authorization.kind !== "authorized" || authorization.user.status !== "ACTIVE") {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Active user required." } }, 403);
  }
  if (!isSameOrigin(request)) {
    return protectedJson({ error: { code: "FORBIDDEN", message: "Cross-origin requests forbidden." } }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return protectedJson({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body." } }, 400);
  }

  const parsed = patchNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return protectedJson(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid payload." } },
      400,
    );
  }

  const supabase = await createClient();

  try {
    if (parsed.data.all) {
      const count = await markAllNotificationsRead(supabase, authorization.user.id);
      return protectedJson({ success: true, updatedCount: count });
    } else if (parsed.data.notificationId) {
      await markNotificationRead(supabase, authorization.user.id, parsed.data.notificationId);
      return protectedJson({ success: true, notificationId: parsed.data.notificationId });
    }
    return protectedJson({ success: true });
  } catch (err) {
    return protectedJson(
      { error: { code: "UPDATE_FAILED", message: err instanceof Error ? err.message : "Failed to update notification." } },
      500,
    );
  }
}
