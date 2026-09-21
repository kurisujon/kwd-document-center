import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authenticationFailureRedirectPath, getSafeRedirectPath } from "./redirect";
import { getSupabaseEnv, isSupabaseConfigured } from "../supabase/env";
import { protectResponse } from "../http/response";
import { logOperationalFailure } from "../observability/log";

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
    if (!configured()) {
      logOperationalFailure({ operation: "auth.callback", outcome: "failure", category: "SUPABASE_NOT_CONFIGURED", status: 503 });
      return protectResponse(NextResponse.redirect(new URL("/login?error=configuration", url.origin)), { noReferrer: true });
    }

    const code = url.searchParams.get("code");
    if (!code) return protectResponse(NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin)), { noReferrer: true });

    const response = NextResponse.redirect(new URL(safeNext, url.origin));
    try {
      const { error } = await exchange(code, request, response);
      if (error) {
        logOperationalFailure({ operation: "auth.callback", outcome: "failure", category: "SESSION_EXCHANGE_REJECTED", status: 502 });
        return protectResponse(NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin)), { noReferrer: true });
      }
      return protectResponse(response, { noReferrer: true });
    } catch {
      logOperationalFailure({ operation: "auth.callback", outcome: "failure", category: "SESSION_EXCHANGE_FAILED", status: 502 });
      return protectResponse(NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin)), { noReferrer: true });
    }
  };
}
