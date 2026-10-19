/**
 * The owner's kudos channel key.
 *
 *   GET /api/realtime/kudos-room   200 { roomKey }
 *                                  401/403 not the owner
 *                                  503 the server can't derive keys
 *
 * The kudos wall is one Realtime channel per workspace. Its name used to be
 * the owner's user id, which isn't secret; it is now a key only the server
 * can derive (see lib/realtime/room-keys). Guests get the same key from their
 * invite's page, rendered on the server.
 */

import { NextResponse } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { kudosRoomKey } from "@/lib/realtime/room-keys";

export const dynamic = "force-dynamic";

export async function GET() {
  let userId: string;
  try {
    ({
      user: { id: userId },
    } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const roomKey = kudosRoomKey(userId);
  if (!roomKey) {
    return NextResponse.json(
      { error: "room_keys_unavailable", message: "The server can't derive room keys." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json({ roomKey }, { headers: { "cache-control": "no-store" } });
}
