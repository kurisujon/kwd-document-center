import { LoginButton } from "@/components/auth/login-button";
import { LoginShowcase } from "@/components/auth/login-showcase";
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
          <div className="eyebrow">Kiblawan Water District</div>
          <h1 id="login-title">
            Turn Official Records Into <span className="heading-gradient">Instant Access.</span>
          </h1>
          <p className="login-hero-lead">
            Upload, register, search, and access official KWD documents in one connected workspace backed by Google Drive.
          </p>

          <div className="login-auth-box" aria-label="Sign in">
            <div className="login-auth-box-header">
              <h2>Authorized Staff Sign-In</h2>
              <span className="bento-pill">Google Workspace</span>
            </div>
            <p>Use your authorized KWD account to open the document registry.</p>
            {error && messages[error] && <p className="notice" role="alert">{messages[error]}</p>}
            <div className="login-actions"><LoginButton /></div>
            <p className="login-footer-link">
              <Link className="clear-filter" href="/privacy-policy">Privacy Policy</Link>
              <span> · Protected by KWD role verification</span>
            </p>
          </div>

          <ul className="login-trust-pills" aria-label="Platform capabilities">
            <li>
              <span className="login-trust-icon" aria-hidden="true">🎯</span>
              <span>Fast metadata search</span>
            </li>
            <li>
              <span className="login-trust-icon" aria-hidden="true">📄</span>
              <span>Google Drive repository</span>
            </li>
            <li>
              <span className="login-trust-icon" aria-hidden="true">⚡</span>
              <span>Role-based access control</span>
            </li>
          </ul>
        </section>

        <section className="login-brand-tile" aria-label="Live workflow preview">
          <LoginShowcase />
        </section>
      </div>
    </main>
  );
}
