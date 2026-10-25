import { LoginButton } from "@/components/auth/login-button";
import Link from "next/link";
const messages: Record<string, string> = { unauthorized: "You are not authorized to use this application.", inactive: "Your account has been deactivated. Contact an administrator.", auth: "Your session has ended. Please sign in again.", configuration: "Sign-in is not configured yet. Contact the system administrator." };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <div className="login-bento">
        <section className="login-brand-tile" aria-labelledby="login-title">
          <div className="wordmark">Kiblawan Water District</div>
          <h1 id="login-title">Document Center</h1>
          <p>Find and access official KWD documents from one secure place.</p>
        </section>
        <section className="login-panel" aria-label="Sign in">
          <p className="eyebrow">Staff sign-in</p>
          <h2>Access the registry</h2>
          <p>Sign in with your authorized Google account to search, view, and register official KWD documents.</p>
          {error && messages[error] && <p className="notice" role="alert">{messages[error]}</p>}
          <div className="login-actions"><LoginButton /></div>
          <p className="login-footer-link"><Link className="clear-filter" href="/privacy-policy">Privacy Policy</Link></p>
        </section>
      </div>
    </main>
  );
}
