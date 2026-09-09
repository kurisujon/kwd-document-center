import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authenticationFailureRedirectPath, getSafeRedirectPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured, getSupabaseEnv } from "@/lib/supabase/env";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const safeNext = getSafeRedirectPath(url.searchParams.get("next"));
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL("/login?error=configuration", url.origin));

  const response = NextResponse.redirect(new URL(safeNext, url.origin));
  const { url: supabaseUrl, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(authenticationFailureRedirectPath, url.origin));
  return response;
}
