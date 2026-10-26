import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | KWD Document Center",
  description: "Privacy information for Kiblawan Water District's KWD Document Center.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="login-page">
      <article className="login-panel" aria-labelledby="privacy-title">
        <p className="login-back-nav">
          <Link className="back-link" href="/login">
            ← Back to sign in
          </Link>
        </p>
        <div className="wordmark">Kiblawan Water District</div>
        <h1 id="privacy-title">Privacy Policy</h1>

        <p>
          KWD Document Center is an internal document-management system for
          personnel authorized by Kiblawan Water District (KWD). It supports
          access to, registration of, and storage of official KWD documents.
        </p>

        <section>
          <h2>Authentication and access</h2>
          <p>
            Google Sign-In is used to authenticate a user&apos;s identity. The
            application receives the basic Google account identity information
            needed for authentication, such as the user&apos;s email address and
            basic profile information. Authentication alone does not grant
            access: the application separately checks the identity against
            KWD&apos;s authorized-user records and account status.
          </p>
        </section>

        <section>
          <h2>Document storage and Google Drive</h2>
          <p>
            Official document files are stored in Google Drive. Google Sign-In
            for user authentication and Google Drive authorization for document
            storage are separate flows. Drive access uses the limited scope
            <code> https://www.googleapis.com/auth/drive.file</code>. The
            application does not request unrestricted Google Drive access.
          </p>
        </section>

        <section>
          <h2>Application data and service providers</h2>
          <p>
            Uploaded document metadata, authorized-user records, roles,
            permissions, and related application data may be registered in
            Supabase. The system relies on Google, Supabase, and Vercel for
            authentication, storage, database, and hosting services, so data is
            processed through those providers as part of operating the
            application. Access to the application and its document functions is
            restricted to authorized personnel.
          </p>
        </section>

        <section>
          <h2>Environment and credential safeguards</h2>
          <p>
            Production and Preview or test environments are kept separate.
            OAuth credentials, tokens, and other server secrets are handled as
            server-side configuration and are not intentionally exposed to end
            users.
          </p>
        </section>

        <section>
          <h2>Privacy and access concerns</h2>
          <p>
            For questions about privacy or application access, contact Kiblawan
            Water District using the official support contact shown during the
            Google Sign-In process or provided by KWD administration.
          </p>
        </section>

        <p>
          <Link className="table-action" href="/login">
            Back to sign in
          </Link>
        </p>
      </article>
    </main>
  );
}
