"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginButton() {
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/documents` },
      });
      if (signInError) setError("We could not start Google sign-in. Please try again.");
    } catch {
      setError("Sign-in is not configured yet. Contact the system administrator.");
    }
  }

  return <><button className="button button-primary" type="button" onClick={signIn}>Continue with Google</button>{error && <p className="form-error" role="alert">{error}</p>}</>;
}
