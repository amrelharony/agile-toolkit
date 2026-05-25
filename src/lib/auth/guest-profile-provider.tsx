"use client";

import { createContext, useContext } from "react";

/**
 * Client-side context exposing the current guest profile.
 *
 * The (guest) route group's server layout reads the cookie via
 * `getGuestSession()` and passes the resolved profile into this
 * provider. Anything inside (guest)/* can then call `useGuestProfile()`
 * without re-fetching.
 *
 * In owner-side routes the provider is not mounted, so
 * `useGuestProfile()` returns null. The collab hook uses that as
 * the "owner vs guest" mode signal.
 */

export interface GuestProfile {
  id: string;
  displayName: string;
  color: string;
  squadId: string;
}

const GuestProfileContext = createContext<GuestProfile | null>(null);

export function GuestProfileProvider({
  profile,
  children,
}: {
  profile: GuestProfile | null;
  children: React.ReactNode;
}) {
  return <GuestProfileContext.Provider value={profile}>{children}</GuestProfileContext.Provider>;
}

export function useGuestProfile(): GuestProfile | null {
  return useContext(GuestProfileContext);
}
