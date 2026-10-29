import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationKind =
  | "REMINDER_90"
  | "REMINDER_30"
  | "REMINDER_7"
  | "RETENTION_FLAGGED"
  | "COMMENT"
  | "STATUS_CHANGE"
  | "GENERAL";

export interface NotificationRecord {
  id: string;
  user_id: string;
  kind: NotificationKind;
  document_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export function sanitizeNotificationContent(
  title: string,
  body: string,
  isConfidential: boolean,
  recipientRole: "ADMIN" | "STAFF" | "VIEWER",
): { title: string; body: string } {
  if (!isConfidential || recipientRole === "ADMIN") {
    return { title, body };
  }
  return {
    title: "Document Notification",
    body: "You have received an update regarding a restricted district record.",
  };
}

export async function createNotification(
  supabase: SupabaseClient,
  params: {
    userId: string;
    kind: NotificationKind;
    documentId?: string | null;
    title: string;
    body: string;
  },
): Promise<NotificationRecord> {
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: params.userId,
      kind: params.kind,
      document_id: params.documentId ?? null,
      title: params.title,
      body: params.body,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create notification: ${error.message}`);
  }

  return data as NotificationRecord;
}

export async function listUserNotifications(
  supabase: SupabaseClient,
  userId: string,
  options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<{ notifications: NotificationRecord[]; total: number; unreadCount: number }> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let query = supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options?.unreadOnly) {
    query = query.is("read_at", null);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to list notifications: ${error.message}`);
  }

  // Count unread
  const { count: unreadCount, error: countError } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (countError) {
    throw new Error(`Failed to count unread notifications: ${countError.message}`);
  }

  return {
    notifications: (data ?? []) as NotificationRecord[],
    total: count ?? 0,
    unreadCount: unreadCount ?? 0,
  };
}

export async function markNotificationRead(
  supabase: SupabaseClient,
  userId: string,
  notificationId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to mark notification read: ${error.message}`);
  }
  return true;
}

export async function markAllNotificationsRead(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to mark all notifications read: ${error.message}`);
  }
  return data ? data.length : 0;
}

export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    return 0;
  }
  return count ?? 0;
}
