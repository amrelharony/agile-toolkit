/**
 * The owner's Realtime room token.
 *
 *   POST /api/realtime/token   200 { token, expiresAt }
 *                              401 unauthenticated
 *                              403 not_authorized | wrong_provider | email_unverified
 *                              503 auth_unavailable | auth_unreachable
 *                              503 private_rooms_unavailable (SUPABASE_JWT_SECRET unset)
 *
 * Room channels run on the anon client, which carries no identity. With
 * private rooms on, the client sets this token on that client so the
 * database policy (migration 0026) sees `room_owner: true` and lets the
 * owner join any `tool:` room. `expiresAt` is ms since the epoch; the
 * client refreshes before it. Errors are the shared `{ error, message }`
 * JSON, passed through from requireAuthorizedUser unchanged.
 */

import { NextResponse } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { mintRoomToken, privateRoomsConfigured } from "@/lib/realtime/room-token";

/** The answer depends on the caller's cookies: never prerender or cache it. */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST() {
  if (!privateRoomsConfigured()) {
    return NextResponse.json(
      {
        error: "private_rooms_unavailable",
        message: "The server can't sign room tokens.",
      },
      { status: 503, headers: NO_STORE }
    );
  }

  let userId: string;
  try {
    ({
      user: { id: userId },
    } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const { token, expiresAt } = mintRoomToken({ sub: userId, roomOwner: true });
  return NextResponse.json({ token, expiresAt }, { headers: NO_STORE });
}
