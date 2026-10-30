"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedUploadQueue } from "@/lib/documents/upload-queue";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    if (sharedUploadQueue.getSnapshot().hasActive) {
      const confirmSignOut = window.confirm(
        "Uploads are currently in progress. Signing out will cancel active uploads. Do you want to continue?",
      );
      if (!confirmSignOut) return;
      sharedUploadQueue.clear();
    }
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className="sign-out" type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
