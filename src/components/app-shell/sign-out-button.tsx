"use client";
import { createClient } from "@/lib/supabase/client";
import { sharedUploadQueue } from "@/lib/documents/upload-queue";

export function SignOutButton() {
  async function signOut() {
    if (sharedUploadQueue.getSnapshot().hasActive) {
      const confirmSignOut = window.confirm(
        "Uploads are currently in progress. Signing out will cancel active uploads. Do you want to continue?",
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
