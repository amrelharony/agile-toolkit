/**
 * A tool page's cloud-persisted blob (a usePersisted user_state row), as an
 * action reads it on either transport: the caller's row over MCP, this
 * browser's localStorage mirror of it in the tab.
 *
 * For actions that read a page's old blob beside the workspace entity it
 * moves into (the Risk Register's and the Tech Debt page's, with their
 * moved-ids records), so the generic CRUD sees the rows still waiting for
 * the page's one-time move as the tool verbs do. Server-safe: no "use
 * client" module (the browser branch reads window.localStorage directly).
 */

import { serverGetUserStateBlob } from "./server-store";

/** The ids in a stored moved-ids record (anything else reads as none). */
export const movedIdsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/**
 * The blob stored under `key`: the user's user_state row when `userId` is
 * given (the MCP transport), else this browser's copy; null when there is
 * none, or the browser's can't be read.
 */
export async function readUserStateBlob(key: string, userId?: string): Promise<unknown> {
  if (userId) return serverGetUserStateBlob(userId, key);
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** A page's old blob and its moved-ids record, read together on one transport. */
export async function readLegacyBlob(
  key: string,
  movedKey: string,
  userId?: string
): Promise<{ raw: unknown; moved: string[] }> {
  const [raw, moved] = await Promise.all([
    readUserStateBlob(key, userId),
    readUserStateBlob(movedKey, userId),
  ]);
  return { raw, moved: movedIdsOf(moved) };
}
