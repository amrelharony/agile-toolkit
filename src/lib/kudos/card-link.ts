/**
 * A kudos card sent as a link, for a visitor's kudos: the card itself rides in
 * the address after the `#` (/kudos#k=s1.…), which browsers never send to a
 * server, so the card is stored nowhere but in the link. Anyone holding the
 * link can read the card, which is why the form keeps to first names and
 * general thanks.
 *
 * Built on lib/share/snapshot (deflate, base64url, size caps, a
 * prototype-safe parse), and checked on the way in by the same parser as every
 * other kudos, so a link can only ever open a card the wall could show.
 */

import type { Kudos } from "@/lib/stores/workspace-types";
import { parseKudos } from "./parse";
import { SnapshotError, decodeSnapshot, encodeSnapshot } from "@/lib/share/snapshot";

const TOOL = "kudos-card";
const SCHEMA = 1;
/** What a card link's fragment starts with. */
export const CARD_LINK_HASH = "#k=";

/** The card's face: what the link carries, and nothing else about anyone. */
export interface CardLinkData {
  theme: Kudos["theme"];
  episode?: number;
  toName: string;
  fromName: string;
  message: string;
  sentAt: string;
}

/** The face of `kudos`, as its link carries it. */
export function cardLinkData(kudos: Kudos): CardLinkData {
  return {
    theme: kudos.theme,
    ...(kudos.episode !== undefined ? { episode: kudos.episode } : {}),
    toName: kudos.toName,
    fromName: kudos.fromName,
    message: kudos.message,
    sentAt: kudos.sentAt,
  };
}

/** The card a link's face shows, through the kudos parser, or null. */
function cardFrom(data: unknown): Kudos | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const face = data as Record<string, unknown>;
  // The date only labels the card. Another device's clock may run a little
  // ahead, which the parser (guarding the wall against future-dated rows)
  // refuses, so it checks a past date and the card keeps the one it was sent.
  if (typeof face.sentAt !== "string" || !Number.isFinite(Date.parse(face.sentAt))) return null;
  const parsed = parseKudos({
    id: "kudos-link",
    theme: face.theme,
    episode: face.episode,
    toName: face.toName,
    fromName: face.fromName,
    message: face.message,
    sentAt: new Date(0).toISOString(),
  });
  if (!parsed.ok) return null;
  return { ...parsed.kudos, sentAt: face.sentAt };
}

/** Checked after decoding, so a link that isn't a card gets a kudos sentence. */
const anyData = (data: unknown): data is unknown => true;

/** The link that opens `kudos` on `origin`'s Kudos page. */
export async function cardLink(kudos: Kudos, origin: string): Promise<string> {
  const payload = await encodeSnapshot({ tool: TOOL, schema: SCHEMA, data: cardLinkData(kudos) });
  return `${origin}/kudos${CARD_LINK_HASH}${payload}`;
}

/** Whether a page's fragment is a card link's. */
export function isCardLinkHash(hash: string): boolean {
  return hash.startsWith(CARD_LINK_HASH);
}

/**
 * The card a fragment carries. Throws a SnapshotError with a sentence to show
 * when the link is damaged, too long or not a card.
 */
export async function readCardLink(hash: string): Promise<Kudos> {
  if (!isCardLinkHash(hash)) throw new SnapshotError("This isn't a kudos link.");
  const envelope = await decodeSnapshot(hash.slice(CARD_LINK_HASH.length), anyData);
  const card =
    envelope.tool === TOOL && envelope.schema === SCHEMA ? cardFrom(envelope.data) : null;
  if (!card) throw new SnapshotError("This link doesn't hold a kudos card.");
  return card;
}
