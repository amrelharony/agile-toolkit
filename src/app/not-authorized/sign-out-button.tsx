"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { signOutThisBrowser } from "@/lib/auth/sign-out";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    const supabase = getAuthBrowserClient();
    // Removes the session from this browser even when the server call
    // fails; we redirect either way so the user isn't stuck.
    if (supabase) await signOutThisBrowser(supabase);
    // Hard navigation home: every tool works signed out, and the full load
    // drops any in-memory auth state.
    window.location.href = "/";
  };

  return (
    <Button onClick={handleSignOut} disabled={busy} variant="outline">
      {busy ? "Signing out…" : "Sign out and continue as a visitor"}
    </Button>
  );
}
