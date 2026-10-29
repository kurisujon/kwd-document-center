"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { hasMinimumRole } from "@/lib/auth/permissions";
import type { AuthorizedUser } from "@/lib/auth/types";
import { SignOutButton } from "./sign-out-button";

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || (href === "/documents" && Boolean(pathname?.startsWith("/documents/")) && pathname !== "/documents/upload");
}

type NavIconName = "documents" | "upload" | "users" | "folders";

function NavIcon({ name }: { name: NavIconName }) {
  if (name === "documents") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </svg>
    );
  }
  if (name === "upload") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m17 8-5-5-5 5" />
        <path d="M12 3v12" />
      </svg>
    );
  }
  if (name === "folders") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function NavItem({ href, label, icon, onNavigate }: { href: string; label: string; icon: NavIconName; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = isNavigationItemActive(pathname, href);
  return <li><Link className={`nav-link ${active ? "nav-link-active" : ""}`} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}><span className="nav-marker" aria-hidden="true"><NavIcon name={icon} /></span><span>{label}</span></Link></li>;
}

export function Navigation({ user }: { user: AuthorizedUser }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <>
    <header className="mobile-header">
      <Link className="mobile-brand" href="/documents">
        <Image src="/kwd-logo.png" alt="Kiblawan Water District Logo" width={28} height={28} priority className="brand-logo" />
        <span>KWD Document Center</span>
      </Link>
      <button className="menu-button" type="button" aria-expanded={open} aria-controls="primary-sidebar" onClick={() => setOpen((value) => !value)}><span aria-hidden="true">{open ? "×" : "☰"}</span><span className="sr-only">{open ? "Close navigation" : "Open navigation"}</span></button>
    </header>
    {open && <button className="nav-scrim" type="button" aria-label="Close navigation" onClick={close} />}
    <aside id="primary-sidebar" className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <Link className="sidebar-brand" href="/documents" onClick={close}>
        <Image src="/kwd-logo.png" alt="Kiblawan Water District Logo" width={34} height={34} priority className="brand-logo" />
        <span><strong>KWD</strong><small>Document Center</small></span>
      </Link>
      <nav aria-label="Primary navigation"><p className="nav-label">Workspace</p><ul className="nav-list"><NavItem href="/documents" label="Documents" icon="documents" onNavigate={close} />{hasMinimumRole(user.role, "STAFF") && <NavItem href="/documents/upload" label="Upload center" icon="upload" onNavigate={close} />}{user.role === "ADMIN" && <><li className="nav-divider" aria-hidden="true" /><li className="nav-label nav-label-item">Administration</li><NavItem href="/admin/users" label="User access" icon="users" onNavigate={close} /><NavItem href="/admin/folders" label="Folders & destinations" icon="folders" onNavigate={close} /></>}</ul></nav>
      <div className="sidebar-footer"><div className="user-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</div><div className="user-summary"><strong>{user.name}</strong><span>{user.role.toLowerCase()}</span></div><SignOutButton /></div>
    </aside>
  </>;
}
