"use client";

import { useIsOwner } from "@/lib/auth/use-is-owner";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";

/**
 * Whether this viewer may open Supabase Realtime channels.
 *
 * Only two audiences have anyone to collaborate with: the verified owner
 * and an invited squad guest (the (guest) tree mounts GuestProfileProvider
 * but no AuthProvider). A public visitor's rooms would be channels nobody
 * else can join, burning the owner's Realtime quota and streaming board
 * content off the device that the site promises keeps it local. Callers
 * pass a null room/channel for them, which lands on the existing
 * local-only paths.
 *
 * Both hooks tolerate their provider being absent, so this works in
 * either tree.
 */
export function useRealtimeAllowed(): boolean {
  const isOwner = useIsOwner();
  const guest = useGuestProfile();
  return isOwner || guest !== null;
}
