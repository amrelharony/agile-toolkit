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
 * The provider accepts a non-null identity; when auth is loading, anonymous,
 * disabled, or errored we pass null via the (presence-identity-internal)
 * context default by not wrapping at all — useRoom's contextIdentity selector
 * falls through to `getOrCreateUser()` in that case, matching the legacy path
 * for solo tools that work without an account.
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

  if (!identity) return <>{children}</>;
  return <PresenceIdentityProvider identity={identity}>{children}</PresenceIdentityProvider>;
}
