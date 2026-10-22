/**
 * Private Realtime rooms: the rollout flag and the owner-feed channel config.
 *
 * With `NEXT_PUBLIC_PRIVATE_ROOMS=1`, every Realtime channel is joined as a
 * private channel (`config: { private: true }`), so Supabase checks the
 * `realtime.messages` RLS policy (`public.realtime_room_allowed`) before it
 * lets anyone in:
 *
 * - owner and squad-guest rooms (`tool:*`) carry a short-lived room token
 *   minted by our server (see `room-auth.ts`);
 * - visitor rooms (`visitor:*`) join with the plain anon key, still gated
 *   by their 12-character code;
 * - the owner's own feeds (`user-sync:<id>`, `history:<id>`,
 *   `agent-conversations-live`) ride the owner's Supabase session JWT on the
 *   auth client, so they need no room token: only the `private` flag.
 *
 * With the flag unset, nothing changes: every channel opens exactly as it
 * did before (public, same arguments). That must stay true until the owner
 * has pushed the policy migration and turned the flag on; only then can
 * "Allow public access" be switched off in Supabase.
 *
 * No browser globals at import time.
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * True only when the build set `NEXT_PUBLIC_PRIVATE_ROOMS=1`. Next inlines
 * the value at build time, so turning it on or off needs a redeploy. Read
 * on every call (not cached) so tests can stub it.
 */
export function privateRoomsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PRIVATE_ROOMS === "1";
}

/**
 * Open one of the owner's own feeds on `client` (the owner's auth client,
 * which already carries their session JWT).
 *
 * Flag off: `client.channel(name)`, with no second argument, exactly as the
 * feeds have always opened. Flag on: the same channel, private.
 */
export function ownerFeedChannel(
  client: Pick<SupabaseClient, "channel">,
  name: string
): RealtimeChannel {
  return privateRoomsEnabled()
    ? client.channel(name, { config: { private: true } })
    : client.channel(name);
}
