"use client";

import Link from "next/link";
import { useState } from "react";
import type { NotificationRecord } from "@/lib/notifications/notification-service";

interface NotificationsViewProps {
  initialNotifications: NotificationRecord[];
  initialUnreadCount: number;
}

export function NotificationsView({
  initialNotifications,
  initialUnreadCount,
}: NotificationsViewProps) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = useState<number>(initialUnreadCount);
  const [filterUnreadOnly, setFilterUnreadOnly] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const displayedNotifications = filterUnreadOnly
    ? notifications.filter((n) => !n.read_at)
    : notifications;

  async function handleMarkAsRead(id: string) {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    } catch {
      // Ignored for smoother UI
    }
  }

  async function handleMarkAllAsRead() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })),
        );
        setUnreadCount(0);
      } else {
        setError("Failed to mark all notifications as read.");
      }
    } catch {
      setError("Network error marking notifications as read.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="notifications-container" aria-label="Notifications center">
      <div className="results-heading">
        <div>
          <p className="eyebrow">Alerts and reminders</p>
          <h1>Notifications</h1>
          <p>
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
              : "All caught up! No unread notifications."}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {unreadCount > 0 && (
            <button
              className="button button-secondary"
              type="button"
              disabled={loading}
              onClick={handleMarkAllAsRead}
            >
              {loading ? "Marking…" : "Mark all as read"}
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBlock: "1rem", display: "flex", gap: "0.5rem" }}>
        <button
          className={`button ${!filterUnreadOnly ? "button-primary" : "button-secondary"}`}
          type="button"
          onClick={() => setFilterUnreadOnly(false)}
        >
          All ({notifications.length})
        </button>
        <button
          className={`button ${filterUnreadOnly ? "button-primary" : "button-secondary"}`}
          type="button"
          onClick={() => setFilterUnreadOnly(true)}
        >
          Unread ({unreadCount})
        </button>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {displayedNotifications.length === 0 ? (
        <p className="file-unavailable">
          {filterUnreadOnly
            ? "No unread notifications to display."
            : "No notifications recorded yet."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="notifications-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Notification</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedNotifications.map((notif) => {
                const isUnread = !notif.read_at;
                return (
                  <tr
                    key={notif.id}
                    style={{
                      background: isUnread ? "rgba(37, 99, 235, 0.05)" : undefined,
                    }}
                  >
                    <td>
                      <span className="type-label">{notif.kind}</span>
                    </td>
                    <td>
                      <div>
                        <strong>{notif.title}</strong>
                        {isUnread && (
                          <span
                            style={{
                              marginLeft: "0.5rem",
                              fontSize: "0.75rem",
                              color: "#2563eb",
                              fontWeight: "bold",
                            }}
                          >
                            ● New
                          </span>
                        )}
                        <p style={{ margin: "0.25rem 0 0 0", color: "#4b5563" }}>
                          {notif.body}
                        </p>
                        {notif.document_id && (
                          <Link
                            className="table-action"
                            style={{ display: "inline-block", marginTop: "0.25rem" }}
                            href={`/documents/${notif.document_id}`}
                          >
                            View document →
                          </Link>
                        )}
                      </div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(notif.created_at).toLocaleString()}
                    </td>
                    <td>
                      {isUnread ? (
                        <button
                          className="table-action"
                          type="button"
                          onClick={() => handleMarkAsRead(notif.id)}
                        >
                          Mark read
                        </button>
                      ) : (
                        <span style={{ color: "#9ca3af", fontSize: "0.875rem" }}>Read</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
