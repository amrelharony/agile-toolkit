/**
 * The team's purpose: the newest agreed Team Canvas's "Why we exist as a
 * team" line, for the team charter and Amr.
 *
 * Its own small module so the charter (/team) can show one line without
 * loading Kickoff's model, its format catalog and the sectioned kit. It
 * reads only what it needs from each row, the same way `normalizeKickoff`
 * and `answerOf` do (test/kickoff/purpose.test.ts holds the two together),
 * and lib/kickoff/model re-exports it.
 *
 * Pure and server-safe: no zod, no React, no store, no "use client" imports.
 */

import { KICKOFF_ITEM_MAX } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import { isExampleId } from "@/lib/utils/example-id";

/** lib/sectioned's SECTION_ITEM_ID_MAX: a line's id is 1 to 64 characters. */
const ITEM_ID_MAX = 64;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const own = (o: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const isoOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? v : undefined;

/**
 * The purpose answer of a row's sections, as `answerOf` reads it after
 * `normalizeKickoff`: the first readable line (a string id of 1 to 64
 * characters and a string text), cut to the item cap, on one line; "" when
 * that line is blank or there is none. A single answer keeps only its first
 * readable line, so a blank one isn't passed over for a later one.
 */
function purposeAnswer(sections: unknown): string {
  if (!isRecord(sections)) return "";
  const lines = own(sections, "purpose");
  if (!Array.isArray(lines)) return "";
  for (const line of lines) {
    if (!isRecord(line)) continue;
    const { id, text } = line;
    if (typeof id !== "string" || !id || id.length > ITEM_ID_MAX) continue;
    if (typeof text !== "string") continue;
    return cutText(text, KICKOFF_ITEM_MAX).replace(/\s+/g, " ").trim();
  }
  return "";
}

interface AgreedCanvas {
  id: string;
  /** When it was agreed, or its last change when that isn't a time. */
  at: string;
  updatedAt: string;
  createdAt: string;
  text: string;
}

/**
 * The purpose of the newest agreed Team Canvas (examples left out), for
 * the team charter and Amr; null when there is none. Newest is by when it
 * was agreed (its last change when that isn't recorded), then Kickoff's own
 * order: newest change, newest made, then by id.
 */
export function teamPurpose(
  rows: readonly unknown[] | undefined
): { kickoffId: string; text: string } | null {
  const agreed: AgreedCanvas[] = [];
  for (const raw of rows ?? []) {
    if (!isRecord(raw)) continue;
    const { id } = raw;
    if (typeof id !== "string" || !id || isExampleId(id)) continue;
    if (raw.format !== "team-canvas" || raw.status !== "agreed") continue;
    const updatedAt = str(raw.updatedAt);
    agreed.push({
      id,
      at: isoOrUndefined(raw.agreedAt) ?? updatedAt,
      updatedAt,
      createdAt: str(raw.createdAt),
      text: purposeAnswer(raw.sections),
    });
  }
  agreed.sort(
    (a, b) =>
      b.at.localeCompare(a.at) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id)
  );
  for (const k of agreed) {
    if (k.text) return { kickoffId: k.id, text: k.text };
  }
  return null;
}
