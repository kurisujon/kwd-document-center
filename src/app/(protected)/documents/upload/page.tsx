import { AdminUploadForm } from "@/components/documents/admin-upload-form";
import { requireRole } from "@/lib/auth/server";
import { adminCategories } from "@/lib/documents/admin-categories";
import { getAdminUploadMaxBytes } from "@/lib/documents/upload-validation";

export default async function UploadPage() {
  await requireRole("STAFF");
  return <>
    <header className="page-heading"><div><h1>Upload Admin documents</h1><p>Review one or more files, then store each in its configured KWD Drive destination with independent metadata.</p></div></header>
    <AdminUploadForm categories={adminCategories} maxBytes={getAdminUploadMaxBytes()} />
  </>;
}
