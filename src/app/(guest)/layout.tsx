/**
 * Guest route group layout.
 *
 * AppShell already detects `/guest` as a bare route and skips its
 * sidebar/header/providers, so this layout only needs to inject the
 * GuestProfileProvider populated from the cookie. Individual guest
 * pages own their own visual wrapping (form pages center a card; the
 * canvas page takes the full viewport).
 */

import type { Metadata } from "next";
import { getGuestSession } from "@/lib/auth/guest-session";
import { GuestProfileProvider } from "@/lib/auth/guest-profile-provider";
import { PresenceIdentityProvider } from "@/lib/realtime/presence-identity";

// Invite-code and squad-guest pages are reached by link, never by search.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function GuestLayout({ children }: { children: React.ReactNode }) {
  const session = await getGuestSession();
  const profile = session
    ? {
        id: session.profileId,
        displayName: session.displayName,
        color: session.color,
        squadId: session.squadId,
        squadOwnerId: session.squadOwnerId,
      }
    : null;
  const content = <GuestProfileProvider profile={profile}>{children}</GuestProfileProvider>;
  // Realtime presence + diff-sync use this identity for every room
  // joined inside the guest tree. Skipped when no session — the
  // join/setup pages don't mount any realtime rooms.
  if (profile) {
    return (
      <PresenceIdentityProvider identity={{ id: profile.id, name: profile.displayName }}>
        {content}
      </PresenceIdentityProvider>
    );
  }
  return content;
}
