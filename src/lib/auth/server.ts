import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { hasMinimumRole } from "./permissions";
import type { AuthorizationResult, AuthorizedUser, Role } from "./types";

export async function getAuthorization(): Promise<AuthorizationResult> {
  if (!isSupabaseConfigured()) return { kind: "not-authorized" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { kind: "unauthenticated" };

  const { data, error } = await supabase
    .from("users")
    .select("id, email, name, role, status")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  if (error || !data) return { kind: "not-authorized" };
  const profile = data as AuthorizedUser;
  if (profile.status !== "ACTIVE") return { kind: "inactive" };
  return { kind: "authorized", user: profile };
}

export async function requireAuthorizedUser(): Promise<AuthorizedUser> {
  if (!isSupabaseConfigured()) return redirect("/login?error=configuration");
  const authorization = await getAuthorization();
  if (authorization.kind === "authorized") return authorization.user;
  if (authorization.kind === "unauthenticated") return redirect("/login?error=auth");
  return redirect(authorization.kind === "inactive" ? "/login?error=inactive" : "/login?error=unauthorized");
}

export async function requireRole(minimumRole: Role): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser();
  if (!hasMinimumRole(user.role, minimumRole)) return redirect("/documents?error=forbidden");
  return user;
}
