"use client";
import { createClient } from "@/lib/supabase/client";
import { sharedUploadQueue } from "@/lib/documents/upload-queue";

export function SignOutButton() {
  async function signOut() {
    if (sharedUploadQueue.getSnapshot().hasActive) {
      const confirmSignOut = window.confirm(
        "Uploads still being saved will finish. Others will be cancelled. Do you want to sign out?",
      );
      if (!confirmSignOut) return;
      sharedUploadQueue.clear();
    }
    sharedUploadQueue.setActiveUser(null);
    await createClient().auth.signOut();
    // Force a full page navigation to clear client in-memory state
    window.location.href = "/login";
  }

  return (
    <button className="sign-out" type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
