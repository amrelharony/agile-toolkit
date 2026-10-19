"use client";

import { useIsOwner } from "@/lib/auth/use-is-owner";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";
import { visitorRoomsEnabled } from "./visitor-rooms";

export interface RealtimeAllowedOptions {
  /**
   * The caller is about to open a visitor live room (`visitor:<tool>:<code>`)
   * that this viewer agreed to in the consent dialog. Lets a public visitor
   * through, but only while `NEXT_PUBLIC_VISITOR_ROOMS=1`.
   */
  visitorRoom?: boolean;
}

/**
 * Whether this viewer may open Supabase Realtime channels.
 *
 * The verified owner and an invited squad guest always may (the (guest)
 * tree mounts GuestProfileProvider but no AuthProvider). A public visitor
 * may not by default: a room only they can reach would burn the owner's
 * Realtime quota and stream board content off the device that the site
 * promises keeps it local. Callers pass a null room/channel for them,
 * which lands on the existing local-only paths.
 *
 * The one exception is a visitor live room the visitor opted into
 * (`{ visitorRoom: true }`) with the feature flag on. With the flag off,
 * or without the opt-in, a visitor stays local-only exactly as before.
 *
 * Both hooks tolerate their provider being absent, so this works in
 * either tree.
 */
export function useRealtimeAllowed(options: RealtimeAllowedOptions = {}): boolean {
  const isOwner = useIsOwner();
  const guest = useGuestProfile();
  if (isOwner || guest !== null) return true;
  return options.visitorRoom === true && visitorRoomsEnabled();
}
