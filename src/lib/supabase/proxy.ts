import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "./env";
import { logOperationalFailure } from "../observability/log";

export async function updateSession(request: NextRequest, dependencies: {
  isSupabaseConfigured?: () => boolean;
  getSupabaseEnv?: typeof getSupabaseEnv;
  createServerClient?: typeof createServerClient;
} = {}) {
  const configured = dependencies.isSupabaseConfigured ?? isSupabaseConfigured;
  if (!configured()) return NextResponse.next({ request });

  try {
    const { url, anonKey } = (dependencies.getSupabaseEnv ?? getSupabaseEnv)();
    let response = NextResponse.next({ request });
    const supabase = (dependencies.createServerClient ?? createServerClient)(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    // Do not move this check behind other auth logic; it refreshes the authenticated session.
    await supabase.auth.getUser();
    return response;
  } catch {
    logOperationalFailure({ operation: "auth.session_refresh", outcome: "failure", category: "SESSION_REFRESH_FAILED", status: 503 });
    // Protected routes independently call getAuthorization(), which fails closed.
    // Returning a cookie-neutral pass-through avoids redirect loops and stale auth state.
    return NextResponse.next({ request });
  }
}
