/**
 * A tab's secret in a signed room: made once per member id and room,
 * kept in sessionStorage like the room identity (`visitor-rooms.ts`), so a
 * refresh keeps it and closing the tab forgets it. It travels only inside
 * requests encrypted to the host, which ties the member id to it on first
 * use (`sender-tie.ts`). A new tab gets a new identity and a new secret.
 *
 * Every read and write is guarded: with storage blocked, the secret lives
 * in the tab's memory only (the caller keeps it in a ref), as before.
 */

import { isSenderSecret } from "./sender-tie";

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked
  }
}

/**
 * This tab's secret in room `code` as member `member`, under the room
 * kind's `prefix` (e.g. "agile-toolkit:wall-room:"): the stored one when
 * `valid` takes it, else `make()`'s, stored for next time.
 */
export function tabSecret(
  prefix: string,
  code: string,
  member: string,
  make: () => string,
  valid: (v: unknown) => v is string = isSenderSecret
): string {
  const key = `${prefix}secret:${code}:${member}`;
  let stored: string | null = null;
  try {
    stored = session()?.getItem(key) ?? null;
  } catch {
    stored = null;
  }
  if (valid(stored)) return stored;
  const fresh = make();
  try {
    session()?.setItem(key, fresh);
  } catch {
    // Full or blocked: memory only.
  }
  return fresh;
}
