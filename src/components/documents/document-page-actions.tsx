import Link from "next/link";
import { hasMinimumRole } from "@/lib/auth/permissions";
import type { Role } from "@/lib/auth/types";
import { adminCategories } from "@/lib/documents/admin-categories";
import { CreateFolderAction } from "./create-folder-action";
import { HierarchyManagerAction } from "./hierarchy-manager-action";

export function DocumentPageActions({ role }: { role: Role }) {
  return <div className="document-page-actions">{role === "ADMIN" && <><CreateFolderAction categories={adminCategories} /><HierarchyManagerAction /></>}{hasMinimumRole(role, "STAFF") && <Link className="button button-primary" href="/documents/upload">Upload document</Link>}</div>;
}
