import { AdminUploadForm } from "@/components/documents/admin-upload-form";
import { requireRole } from "@/lib/auth/server";
import { adminCategories } from "@/lib/documents/admin-categories";

export default async function UploadPage() {
  await requireRole("STAFF");
  return <>
    <header className="page-heading"><div><h1>Upload Admin document</h1><p>Store the file in the configured KWD Drive destination and register its metadata.</p></div></header>
    <AdminUploadForm categories={adminCategories} />
  </>;
}
