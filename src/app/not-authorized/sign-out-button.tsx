"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    const supabase = getAuthBrowserClient();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* network failure — we redirect anyway so the user isn't stuck */
      }
    }
    // Hard reload so middleware re-evaluates against a now-empty session.
    window.location.href = "/auth/sign-in";
  };

  return (
    <Button onClick={handleSignOut} disabled={busy} variant="outline">
      {busy ? "Signing out…" : "Sign out and try another account"}
    </Button>
  );
}
