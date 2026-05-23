"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { syncEngine } from "./engine";

/**
 * Mounts once under <AuthProvider>. Owns the engine lifecycle:
 *
 *   SIGNED_IN  → start engine: pull all registered adapters, subscribe realtime
 *   SIGNED_OUT → stop engine: clear subscriptions, drop dirty queue
 *
 * No render output — pure side-effect provider. Tools register their
 * stores at module load (well before this component mounts); the engine
 * keeps the registrations and starts/stops them as auth flips.
 */
export function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const supabase = getAuthBrowserClient();

  useEffect(() => {
    if (status !== "authenticated" || !user || !supabase) {
      syncEngine.stop();
      return;
    }
    void syncEngine.start(supabase, user.id);
    return () => {
      // Engine.stop is idempotent; safe to call on unmount or status flip.
      syncEngine.stop();
    };
  }, [status, user, supabase]);

  return <>{children}</>;
}
