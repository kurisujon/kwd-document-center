import { LoginButton } from "@/components/auth/login-button";
import { LoginShowcase } from "@/components/auth/login-showcase";
import Image from "next/image";
import Link from "next/link";

const messages: Record<string, string> = {
  unauthorized: "You are not authorized to use this application.",
  inactive: "Your account has been deactivated. Contact an administrator.",
  auth: "Your session has ended. Please sign in again.",
  configuration: "Sign-in is not configured yet. Contact the system administrator.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <div className="login-bento">
        <section className="login-panel login-hero-panel" aria-labelledby="login-title">
          <div className="login-brand-badge">
            <Image
              src="/kwd-logo.png"
              alt="Kiblawan Water District Logo"
              width={56}
              height={56}
              priority
              className="login-brand-logo"
            />
          </div>
          <div className="eyebrow">Kiblawan Water District</div>
          <h1 id="login-title">KWD Document Center</h1>
          <p className="login-hero-lead">
            Upload, register, search, and access official KWD documents in one workspace backed by Google Drive.
          </p>

          <div className="login-auth-box" aria-label="Sign in">
            <div className="login-auth-box-header">
              <h2>Staff sign-in</h2>
            </div>
            <p>Sign in with your authorized KWD Google account to access the registry.</p>
            {error && messages[error] && <p className="notice" role="alert">{messages[error]}</p>}
            <div className="login-actions"><LoginButton /></div>
            <p className="login-footer-link">
              <Link className="clear-filter" href="/privacy-policy">Privacy Policy</Link>
            </p>
          </div>
        </section>

        <section className="login-brand-tile" aria-label="Document workflow overview">
          <LoginShowcase />
        </section>
      </div>
    </main>
  );
}
