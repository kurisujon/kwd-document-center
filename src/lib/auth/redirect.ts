const applicationOrigin = "https://kwd-document-center.invalid";

export const authenticationFailureRedirectPath = "/login?error=auth";

export function getAuthorizationRedirectPath(kind: "unauthenticated" | "not-authorized" | "inactive" | "auth-error"): string {
  if (kind === "unauthenticated") return "/login";
  if (kind === "auth-error") return authenticationFailureRedirectPath;
  return kind === "inactive" ? "/login?error=inactive" : "/login?error=unauthorized";
}

/**
 * Returns a safe, single-root application path for post-authentication redirects.
 * External, protocol-relative, and malformed paths fall back to Documents.
 */
export function getSafeRedirectPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /^\/(%2f|%5c)/i.test(next)) {
    return "/documents";
  }

  // Backslashes and control characters can change how URLs are interpreted.
  if (next.includes("\\") || Array.from(next).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) {
    return "/documents";
  }

  const destination = new URL(next, applicationOrigin);
  // Dot-segment normalization can create a protocol-relative path. The callback
  // resolves this returned path again, so validate the normalized pathname too.
  if (destination.origin !== applicationOrigin || destination.pathname.startsWith("//")) {
    return "/documents";
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
