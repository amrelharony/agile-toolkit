/**
 * The guestbook's public read: approved notes only, newest first. Server only,
 * through the service role, because the table is closed to everyone else
 * (migration 0033).
 *
 * The same rules as the story read (lib/comics/store): it THROWS at runtime, so
 * a failed read keeps the page's last good copy instead of replacing it with an
 * empty one, and only the build, which runs against a placeholder Supabase,
 * gets an empty list.
 */

import "server-only";
import { getSquadAdminClient } from "@/lib/squads/server";
import type { GuestbookNote } from "./guestbook";

const READ_TIMEOUT_MS = 5_000;
/** The page shows this many; older approved notes stay in the portal. */
export const GUESTBOOK_PAGE_SIZE = 100;

export async function listApprovedNotes(): Promise<GuestbookNote[]> {
  try {
    const client = getSquadAdminClient();
    if (!client) throw new Error("comics: the service role client is not configured");
    const { data, error } = await client
      .from("comic_guestbook")
      .select("id,name,message")
      .not("approved_at", "is", null)
      .order("approved_at", { ascending: false })
      .limit(GUESTBOOK_PAGE_SIZE)
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
      .returns<GuestbookNote[]>();
    if (error) throw new Error(`comics: guestbook read failed: ${error.message}`);
    return data ?? [];
  } catch (err) {
    if (process.env.NEXT_PHASE === "phase-production-build") return [];
    throw err;
  }
}
