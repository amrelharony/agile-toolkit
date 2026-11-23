/**
 * Tying a self-declared member id to the tab that first used it.
 *
 * In a signed room (wall rooms, vote rounds) every member receives every
 * request, and a request's sender (`by`) is whatever the sender says. So
 * each request also carries, inside its encryption to the host, a secret
 * that only the sender's tab holds (`tab-secret.ts`). The host keeps, per
 * member id, the seal of the first secret it saw (its SHA-256, or "" for a
 * request that carried none, from an older build) and refuses that id's
 * requests with any other. Once someone has sent anything, nobody else can
 * send under their id.
 *
 * What it can't cover: the tie is made on first use, so someone who sends
 * under a newcomer's id before the newcomer's own first request takes that
 * id. The rooms tell the newcomer (and the host) when that happens.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { sha256Base64Url } from "./sha256";

/** A tab secret: random, 16 to 64 URL-safe characters (the rooms make nanoid(21)). */
const SENDER_SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** A tab secret: random, 16 to 64 URL-safe characters (the rooms make nanoid(21)). */
export function isSenderSecret(v: unknown): v is string {
  return typeof v === "string" && SENDER_SECRET_RE.test(v);
}

/**
 * What the host keeps of a tab's secret: its SHA-256 (unpadded base64url),
 * so the secret itself isn't kept; "" for a request that carried none.
 */
export function sealOf(secret: string | null | undefined): string {
  return secret ? sha256Base64Url(secret) : "";
}

export type SenderTie =
  /** `senders` is the map to keep: the same one when `by` was already tied, a new one when not. */
  | { ok: true; senders: ReadonlyMap<string, string> }
  /**
   * "not-yours": `by` is tied to another seal (someone else's tab, or a
   * tab of the other kind: one with a secret against one without);
   * "full": `by` is new and `max` ids are tied already (old ones are never
   * dropped, so a member who leaves can't be stood in for later).
   */
  | { ok: false; why: "not-yours" | "full" };

/**
 * Tie `by` to `seal`, or check it against the seal it was tied to. Never
 * mutates `senders`.
 */
export function tieSender(
  senders: ReadonlyMap<string, string> | undefined,
  by: string,
  seal: string,
  max: number
): SenderTie {
  const tied = senders?.get(by);
  if (tied !== undefined) {
    return tied === seal ? { ok: true, senders: senders! } : { ok: false, why: "not-yours" };
  }
  if ((senders?.size ?? 0) >= max) return { ok: false, why: "full" };
  return { ok: true, senders: new Map(senders ?? []).set(by, seal) };
}
