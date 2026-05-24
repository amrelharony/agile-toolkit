"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { syncEngine } from "./engine";
import { resetCloudPersistedRegistry } from "./use-cloud-persisted";

/**
 * Mounts once under <AuthProvider>. Owns the engine lifecycle:
 *
 *   SIGNED_IN  → start engine: pull all registered adapters, subscribe realtime
 *   SIGNED_OUT → stop engine: clear subscriptions, drop dirty queue
 *
 * No render output — pure side-effect provider. Tools register their
 * stores at module load (well before this component mounts); the engine
 * keeps the registrations and starts/stops them as auth flips.
 *
 * BUG-S6: when the signed-in user changes (sign out, then a different
 * user signs in on the same browser), we MUST clear the per-key
 * adapter registry (snapshots + subscribers + adapterDirty + registered)
 * so the new user doesn't inherit the previous user's local cache.
 * Otherwise their first edit would upload the previous user's workspace
 * to the new user's Supabase row.
 */
export function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const supabase = getAuthBrowserClient();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !user || !supabase) {
      if (lastUserIdRef.current !== null) {
        // User just transitioned to unauthenticated — clear the
        // per-key cache so a future sign-in starts fresh.
        resetCloudPersistedRegistry();
        lastUserIdRef.current = null;
      }
      syncEngine.stop();
      return;
    }
    if (lastUserIdRef.current && lastUserIdRef.current !== user.id) {
      // Different user signing in on the same tab. Wipe the previous
      // user's adapter cache before starting the new engine.
      resetCloudPersistedRegistry();
    }
    lastUserIdRef.current = user.id;
    void syncEngine.start(supabase, user.id);
    return () => {
      // Engine.stop is idempotent; safe to call on unmount or status flip.
      syncEngine.stop();
    };
  }, [status, user, supabase]);

  return <>{children}</>;
}
