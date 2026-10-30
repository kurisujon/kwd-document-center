import { Navigation } from "@/components/app-shell/navigation";
import { WindowDropGuard } from "@/components/documents/window-drop-guard";
import { UploadQueueProvider } from "@/components/documents/upload-queue-provider";
import { requireAuthorizedUser } from "@/lib/auth/server";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAuthorizedUser();
  return (
    <div className="app-shell">
      <WindowDropGuard />
      <UploadQueueProvider user={user}>
        <Navigation user={user} />
        <main className="app-main">
          <div className="page-frame">{children}</div>
        </main>
      </UploadQueueProvider>
    </div>
  );
}
