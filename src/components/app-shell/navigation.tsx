"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { hasMinimumRole } from "@/lib/auth/permissions";
import type { AuthorizedUser } from "@/lib/auth/types";
import { SignOutButton } from "./sign-out-button";

export function isNavigationItemActive(pathname: string, href: string) {
  if (href === "/documents") {
    return (
      pathname === "/documents" ||
      (pathname.startsWith("/documents/") &&
        pathname !== "/documents/upload" &&
        pathname !== "/documents/starred")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type NavIconName =
  | "dashboard"
  | "documents"
  | "starred"
  | "reports"
  | "notifications"
  | "tasks"
  | "upload"
  | "users"
  | "folders"
  | "trash"
  | "audit";

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
      );
    case "documents":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <line x1="16" x2="8" y1="13" y2="13" />
          <line x1="16" x2="8" y1="17" y2="17" />
          <line x1="10" x2="8" y1="9" y2="9" />
        </svg>
      );
    case "starred":
      return (
        <svg {...common}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <line x1="12" x2="12" y1="20" y2="10" />
          <line x1="18" x2="18" y1="20" y2="4" />
          <line x1="6" x2="6" y1="20" y2="16" />
        </svg>
      );
    case "notifications":
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...common}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "folders":
      return (
        <svg {...common}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <line x1="10" x2="10" y1="11" y2="17" />
          <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
  }
}

function NavItem({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: NavIconName;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = isNavigationItemActive(pathname, href);
  return (
    <li>
      <Link
        className={`nav-link ${active ? "nav-link-active" : ""}`}
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
      >
        <span className="nav-marker" aria-hidden="true">
          <NavIcon name={icon} />
        </span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

export function Navigation({ user }: { user: AuthorizedUser }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <header className="mobile-header">
        <Link className="mobile-brand" href="/documents">
          <Image
            src="/kwd-logo.png"
            alt="Kiblawan Water District Logo"
            width={28}
            height={28}
            priority
            className="brand-logo"
          />
          <span>KWD Document Center</span>
        </Link>
        <button
          className="menu-button"
          type="button"
          aria-expanded={open}
          aria-controls="primary-sidebar"
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? "×" : "☰"}</span>
          <span className="sr-only">
            {open ? "Close navigation" : "Open navigation"}
          </span>
        </button>
      </header>
      {open && (
        <button
          className="nav-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={close}
        />
      )}
      <aside
        id="primary-sidebar"
        className={`sidebar ${open ? "sidebar-open" : ""}`}
      >
        <Link className="sidebar-brand" href="/documents" onClick={close}>
          <Image
            src="/kwd-logo.png"
            alt="Kiblawan Water District Logo"
            width={34}
            height={34}
            priority
            className="brand-logo"
          />
          <span>
            <strong>KWD</strong>
            <small>Document Center</small>
          </span>
        </Link>
        <p className="sidebar-kicker">Document workspace</p>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          <ul className="nav-list">
            <NavItem
              href="/dashboard"
              label="Dashboard"
              icon="dashboard"
              onNavigate={close}
            />
            <NavItem
              href="/documents"
              label="Documents"
              icon="documents"
              onNavigate={close}
            />
            <NavItem
              href="/documents/starred"
              label="Starred"
              icon="starred"
              onNavigate={close}
            />
            <NavItem
              href="/reports"
              label="Reports"
              icon="reports"
              onNavigate={close}
            />
            <NavItem
              href="/notifications"
              label="Notifications"
              icon="notifications"
              onNavigate={close}
            />
            {hasMinimumRole(user.role, "STAFF") && (
              <NavItem
                href="/tasks"
                label="My tasks"
                icon="tasks"
                onNavigate={close}
              />
            )}
            {hasMinimumRole(user.role, "STAFF") && (
              <NavItem
                href="/documents/upload"
                label="Upload center"
                icon="upload"
                onNavigate={close}
              />
            )}
            {user.role === "ADMIN" && (
              <>
                <li className="nav-divider" aria-hidden="true" />
                <li className="nav-label nav-label-item">Administration</li>
                <NavItem
                  href="/admin/users"
                  label="User access"
                  icon="users"
                  onNavigate={close}
                />
                <NavItem
                  href="/admin/folders"
                  label="Folders & destinations"
                  icon="folders"
                  onNavigate={close}
                />
                <NavItem
                  href="/admin/trash"
                  label="Trash"
                  icon="trash"
                  onNavigate={close}
                />
                <NavItem
                  href="/admin/audit-log"
                  label="Audit log"
                  icon="audit"
                  onNavigate={close}
                />
              </>
            )}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="user-summary">
            <strong>{user.name}</strong>
            <span>{user.role.toLowerCase()}</span>
          </div>
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}
