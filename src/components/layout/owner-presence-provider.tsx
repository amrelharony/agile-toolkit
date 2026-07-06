"use client";

import { useMemo } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { PresenceIdentityProvider, type PresenceIdentity } from "@/lib/realtime/presence-identity";

/**
 * Mounts <PresenceIdentityProvider> with the signed-in owner's identity so
 * the owner tree's realtime hooks (useRoom via useCollaborativeSession and
 * any future direct caller) report the owner's display_name and id to peers
 * instead of falling through to the localStorage-backed `agile-toolkit:user`
 * placeholder.
 *
 * Identity is rebuilt only when the underlying auth fields change — a render
 * caused by unrelated context churn doesn't push a fresh object through the
 * presence context (which would re-trigger useRoom's identity-keyed effect).
 *
 * When auth is loading, anonymous, disabled, or errored we pass identity=null
 * — semantically identical to the context default, so useRoom's
 * contextIdentity selector falls through to `getOrCreateUser()`, matching the
 * legacy path for solo tools that work without an account.
 *
 * ALWAYS render the provider, even with a null identity. Switching the
 * returned root element between a Fragment (unwrapped) and the provider
 * changes the element type at this tree position, so React unmounted and
 * remounted the ENTIRE app subtree the moment auth resolved (~every signed-in
 * page load): local input state wiped, WebGL mascot re-initialised, sync
 * channels torn down and resubscribed. A constant tree shape avoids all that.
 */
export function OwnerPresenceProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthOptional();
  const identity = useMemo<PresenceIdentity | null>(() => {
    if (!auth || auth.status !== "authenticated" || !auth.user) return null;
    const profileName = auth.profile?.display_name ?? null;
    const metaName =
      typeof auth.user.user_metadata === "object" && auth.user.user_metadata
        ? ((auth.user.user_metadata as Record<string, unknown>).full_name as string | undefined)
        : undefined;
    const email = typeof auth.user.email === "string" ? auth.user.email : null;
    const name = profileName || metaName || email || "Owner";
    return { id: auth.user.id, name };
  }, [auth]);

  return <PresenceIdentityProvider identity={identity}>{children}</PresenceIdentityProvider>;
}
