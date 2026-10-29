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
          <div className="login-brand-header">
            <div className="login-brand-badge">
              <Image
                src="/kwd-logo.png"
                alt="Kiblawan Water District Logo"
                width={88}
                height={88}
                priority
                className="login-brand-logo"
              />
            </div>
            <div className="login-institution-badge">
              <span className="login-institution-dot" aria-hidden="true" />
              <span>Kiblawan Water District</span>
            </div>
          </div>

          <div className="login-heading-group">
            <h1 id="login-title" className="login-title">
              <span className="login-title-kwd">KWD</span>
              <span className="login-title-rest">Document Center</span>
            </h1>
            <p className="login-hero-lead">
              Official document registry and archival workspace. Securely upload, index, and retrieve water district records with Google Drive integration.
            </p>
          </div>

          <div className="login-auth-box" aria-label="Sign in">
            <div className="login-auth-box-header">
              <span className="login-auth-shield" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </span>
              <div>
                <h2>Authorized Staff Sign-In</h2>
                <span className="login-auth-sub">KWD Workspace SSO</span>
              </div>
            </div>
            <p>Access requires an approved KWD staff Google Workspace account.</p>
            {error && messages[error] && <p className="notice" role="alert">{messages[error]}</p>}
            <div className="login-actions"><LoginButton /></div>
            <div className="login-auth-footer">
              <Link className="login-privacy-link" href="/privacy-policy">Privacy &amp; Security Policy</Link>
              <span className="login-auth-env-tag">KWD Internal</span>
            </div>
          </div>

          <ul className="login-trust-list" aria-label="System security features">
            <li>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Single Sign-On</span>
            </li>
            <li>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Google Drive</span>
            </li>
            <li>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Encrypted Registry</span>
            </li>
          </ul>
        </section>

        <section className="login-brand-tile" aria-label="Document workflow overview">
          <LoginShowcase />
        </section>
      </div>
    </main>
  );
}
