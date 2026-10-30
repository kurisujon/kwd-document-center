import { Navigation } from "@/components/app-shell/navigation";
import { WindowDropGuard } from "@/components/documents/window-drop-guard";
import { requireAuthorizedUser } from "@/lib/auth/server";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAuthorizedUser();
  return (
    <div className="app-shell">
      <WindowDropGuard />
      <Navigation user={user} />
      <main className="app-main">
        <div className="page-frame">{children}</div>
      </main>
    </div>
  );
}
