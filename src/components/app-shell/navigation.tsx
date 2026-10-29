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

function NavItem({
  href,
  label,
  marker,
  onNavigate,
}: {
  href: string;
  label: string;
  marker: string;
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
          {marker}
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
              marker="B"
              onNavigate={close}
            />
            <NavItem
              href="/documents"
              label="Documents"
              marker="D"
              onNavigate={close}
            />
            <NavItem
              href="/documents/starred"
              label="Starred"
              marker="S"
              onNavigate={close}
            />
            <NavItem
              href="/reports"
              label="Reports"
              marker="R"
              onNavigate={close}
            />
            <NavItem
              href="/notifications"
              label="Notifications"
              marker="N"
              onNavigate={close}
            />
            {hasMinimumRole(user.role, "STAFF") && (
              <NavItem
                href="/tasks"
                label="My tasks"
                marker="K"
                onNavigate={close}
              />
            )}
            {hasMinimumRole(user.role, "STAFF") && (
              <NavItem
                href="/documents/upload"
                label="Upload center"
                marker="U"
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
                  marker="A"
                  onNavigate={close}
                />
                <NavItem
                  href="/admin/folders"
                  label="Folders & destinations"
                  marker="F"
                  onNavigate={close}
                />
                <NavItem
                  href="/admin/trash"
                  label="Trash"
                  marker="T"
                  onNavigate={close}
                />
                <NavItem
                  href="/admin/audit-log"
                  label="Audit log"
                  marker="L"
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
