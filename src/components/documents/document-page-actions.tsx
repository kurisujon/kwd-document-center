import React from "react";
import Link from "next/link";
import { hasMinimumRole } from "@/lib/auth/permissions";
import type { Role } from "@/lib/auth/types";
import { adminCategories } from "@/lib/documents/admin-categories";
import { CreateFolderAction } from "./create-folder-action";
import { HierarchyManagerAction } from "./hierarchy-manager-action";

export function DocumentPageActions({ role }: { role: Role }) {
  return (
    <div className="document-page-actions">
      {role === "ADMIN" && (
        <>
          <CreateFolderAction categories={adminCategories} />
          <HierarchyManagerAction />
        </>
      )}
      {hasMinimumRole(role, "STAFF") && (
        <Link className="button button-primary" href="/documents/upload">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <span>Upload document</span>
        </Link>
      )}
    </div>
  );
}
