import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { hasMinimumRole } from "./permissions";
import { getAuthorizationRedirectPath } from "./redirect";
import type { AuthorizationResult, AuthorizedUser, Role } from "./types";
import { logOperationalFailure } from "../observability/log";

type SessionUser = { email?: string | null } | null;

export type AuthorizationDependencies = {
  isSupabaseConfigured: () => boolean;
  getSessionUser: () => Promise<SessionUser>;
  findAuthorizedUser: (email: string) => Promise<AuthorizedUser | null>;
};

async function getSessionUser(): Promise<SessionUser> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

async function findAuthorizedUser(email: string): Promise<AuthorizedUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, name, role, status")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  return data as AuthorizedUser | null;
}

export async function getAuthorization(overrides: Partial<AuthorizationDependencies> = {}): Promise<AuthorizationResult> {
  const configured = overrides.isSupabaseConfigured ?? isSupabaseConfigured;
  if (!configured()) return { kind: "not-authorized" };

  let user: SessionUser;
  try {
    user = await (overrides.getSessionUser ?? getSessionUser)();
  } catch {
    logOperationalFailure({ operation: "auth.authorization", outcome: "failure", category: "SESSION_LOOKUP_FAILED", status: 503 });
    return { kind: "auth-error" };
  }
  if (!user?.email) return { kind: "unauthenticated" };

  let profile: AuthorizedUser | null;
  try {
    profile = await (overrides.findAuthorizedUser ?? findAuthorizedUser)(user.email.toLowerCase());
  } catch {
    logOperationalFailure({ operation: "auth.authorization", outcome: "failure", category: "AUTHORIZATION_LOOKUP_FAILED", status: 503 });
    return { kind: "auth-error" };
  }
  if (!profile) return { kind: "not-authorized" };
  if (profile.status !== "ACTIVE") return { kind: "inactive" };
  return { kind: "authorized", user: profile };
}

export async function requireAuthorizedUser(): Promise<AuthorizedUser> {
  if (!isSupabaseConfigured()) return redirect("/login?error=configuration");
  const authorization = await getAuthorization();
  if (authorization.kind === "authorized") return authorization.user;
  return redirect(getAuthorizationRedirectPath(authorization.kind));
}

export async function requireRole(minimumRole: Role): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser();
  if (!hasMinimumRole(user.role, minimumRole)) return redirect("/documents?error=forbidden");
  return user;
}
