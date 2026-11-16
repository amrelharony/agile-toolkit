/**
 * Why a live room can't start here, in one line, for a room with no "One
 * screen" fallback of its own (choice, rank and number rounds, show rooms,
 * wall rooms). The vote kit's count entry has its own wording
 * (`unavailableReason` in `vote-room/vote-round-panel.tsx`).
 */

import type { VoteRoomsAvailability } from "@/lib/realtime/vote-room/use-vote-room";

export function liveOnlyReason(reason: VoteRoomsAvailability["reason"]): string | null {
  switch (reason) {
    case "flag-off":
      return "Live rooms are off on this site, so this can't run on people's phones.";
    case "no-realtime":
      return "Live rooms need the realtime service, which isn't set up here.";
    case "no-crypto":
      return "This browser can't run a secure live room (it needs HTTPS and a current browser).";
    case "guest":
      return "Guests can't host live rooms.";
    default:
      return null;
  }
}
