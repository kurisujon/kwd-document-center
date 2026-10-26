import { AdminUploadForm } from "@/components/documents/admin-upload-form";
import { requireRole } from "@/lib/auth/server";
import { adminCategories } from "@/lib/documents/admin-categories";
import { getAdminUploadMaxBytes } from "@/lib/documents/upload-validation";

export default async function UploadPage() {
  await requireRole("STAFF");
  return <>
    <header className="page-heading"><div><p className="eyebrow">Upload center</p><h1>Register <span className="heading-gradient">new documents.</span></h1><p>Choose files or a prepared folder, review every record, then upload to the configured KWD Drive destination.</p></div></header>
    <AdminUploadForm categories={adminCategories} maxBytes={getAdminUploadMaxBytes()} />
  </>;
}
