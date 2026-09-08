"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasMinimumRole } from "@/lib/auth/permissions";
import type { AuthorizedUser } from "@/lib/auth/types";
import { SignOutButton } from "./sign-out-button";
function NavItem({ href, label }: { href: string; label: string }) { const pathname = usePathname(); const active = pathname === href || (href === "/documents" && pathname.startsWith("/documents")); return <li><Link className={`nav-link ${active ? "nav-link-active" : ""}`} href={href}>{label}</Link></li>; }
export function Navigation({ user }: { user: AuthorizedUser }) { return <aside className="sidebar"><div className="sidebar-title">KWD Document Center</div><p className="sidebar-subtitle">Kiblawan Water District</p><nav aria-label="Primary navigation"><ul className="nav-list"><NavItem href="/documents" label="Documents" />{hasMinimumRole(user.role, "STAFF") && <NavItem href="/documents/upload" label="Upload" />}{user.role === "ADMIN" && <><li className="nav-divider" aria-hidden="true" /><NavItem href="/admin/users" label="Users" /></>}</ul></nav><div className="sidebar-footer"><div>{user.name}</div><div>{user.role}</div><SignOutButton /></div></aside>; }
