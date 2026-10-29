import { requireAuthorizedUser } from "@/lib/auth/server";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { listUserNotifications, type NotificationRecord } from "@/lib/notifications/notification-service";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const user = await requireAuthorizedUser();
  const supabase = await createClient();

  let initialNotifications: NotificationRecord[] = [];
  let initialUnreadCount = 0;

  try {
    const result = await listUserNotifications(supabase, user.id, { limit: 50 });
    initialNotifications = result.notifications;
    initialUnreadCount = result.unreadCount;
  } catch {
    // Falls back to empty list on database load error
  }

  return (
    <NotificationsView
      initialNotifications={initialNotifications}
      initialUnreadCount={initialUnreadCount}
    />
  );
}
