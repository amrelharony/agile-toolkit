"use client";

/**
 * Per-tree presence identity override.
 *
 * `useRoom` reads identity in this precedence order:
 *   1. Explicit `options.identity` passed by the caller (wins everything)
 *   2. PresenceIdentityContext if a provider is mounted in the tree
 *   3. localStorage `agile-toolkit:user` (the legacy default)
 *
 * Guest pages mount this provider with their squad-profile id/name so
 * the room presence, the diff-sync `by` field, and the activity-log
 * `author` derive from the guest profile without overwriting the
 * shared localStorage slot — which would contaminate any other tab on
 * the same browser (notably the owner signed in elsewhere).
 *
 * The realtime layer intentionally doesn't know about squads or auth —
 * it just takes whatever identity is supplied.
 */

import { createContext, useContext } from "react";

export interface PresenceIdentity {
  id: string;
  name: string;
}

const PresenceIdentityContext = createContext<PresenceIdentity | null>(null);

export function PresenceIdentityProvider({
  identity,
  children,
}: {
  identity: PresenceIdentity;
  children: React.ReactNode;
}) {
  return (
    <PresenceIdentityContext.Provider value={identity}>{children}</PresenceIdentityContext.Provider>
  );
}

export function usePresenceIdentityOverride(): PresenceIdentity | null {
  return useContext(PresenceIdentityContext);
}
