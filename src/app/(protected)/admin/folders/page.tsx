import type { Metadata } from "next";
import { FolderManagement } from "@/components/folders/folder-management";
import { requireRole } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Folders & Destinations | KWD Document Center",
  description: "Manage folder hierarchy and upload destination settings.",
};

export default async function AdminFoldersPage() {
  await requireRole("ADMIN");
  return <FolderManagement />;
}
