import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authenticationFailureRedirectPath, getSafeRedirectPath } from "./redirect";
import { getSupabaseEnv, isSupabaseConfigured } from "../supabase/env";

type CallbackExchange = (code: string, request: NextRequest, response: NextResponse) => Promise<{ error: unknown | null }>;

async function exchangeCodeForSession(code: string, request: NextRequest, response: NextResponse) {
  const { url: supabaseUrl, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  return supabase.auth.exchangeCodeForSession(code);
}

export function createAuthCallbackHandler(dependencies: {
  isSupabaseConfigured?: () => boolean;
  exchangeCodeForSession?: CallbackExchange;
} = {}) {
  const configured = dependencies.isSupabaseConfigured ?? isSupabaseConfigured;
  const exchange = dependencies.exchangeCodeForSession ?? exchangeCodeForSession;

  return async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const safeNext = getSafeRedirectPath(url.searchParams.get("next"));
    if (!configured()) return NextResponse.redirect(new URL("/login?error=configuration", url.origin));

    const code = url.searchParams.get("code");
    if (!code) return NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin));

    const response = NextResponse.redirect(new URL(safeNext, url.origin));
    try {
      const { error } = await exchange(code, request, response);
      if (error) return NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin));
      return response;
    } catch {
      return NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin));
    }
  };
}
