/**
 * Kudos as appreciation cards. The kudos a team gave during the sprint are
 * the appreciations column it would otherwise write from memory, so the
 * board offers them in the Write phase. Each card keeps a `sourceRef` back
 * to its kudos: the board shows it as "From kudos", and a kudos already on
 * the board (added here, or sent from Kudos later) is never added twice.
 */

import { EXAMPLE_ID_PREFIX, exampleId, isExampleId } from "@/components/tool-frame/example-data";
import { RETRO_CARD_MAX } from "@/lib/retro/board";
import type { RetroFacts } from "@/lib/retro/facts";
import { makeId } from "./helpers";
import type { RetroCard } from "./types";

export type SprintKudos = RetroFacts["kudos"][number];

/** The tool name a kudos card's `sourceRef` carries. */
export const KUDOS_TOOL = "kudos";

/** Ids of the kudos already on the board. */
export function kudosOnBoard(cards: readonly RetroCard[]): Set<string> {
  const out = new Set<string>();
  for (const c of cards) if (c.sourceRef?.tool === KUDOS_TOOL) out.add(c.sourceRef.id);
  return out;
}

/** "Kudos to Sam: Stayed late to fix the flaky tests", on one line, within the card limit. */
export function kudosCardText(k: Pick<SprintKudos, "toName" | "message">): string {
  const to = k.toName.replace(/\s+/g, " ").trim() || "the team";
  const message = k.message.replace(/\s+/g, " ").trim();
  const text = message ? `Kudos to ${to}: ${message}` : `Kudos to ${to}`;
  return text.length > RETRO_CARD_MAX ? `${text.slice(0, RETRO_CARD_MAX - 1).trimEnd()}…` : text;
}

/**
 * The card for an example kudos is an example card too ("example-…"), so
 * Clear example takes it away with the rest of the example.
 */
function cardIdFor(k: Pick<SprintKudos, "id">): string {
  return isExampleId(k.id) ? exampleId(`retro-${k.id.slice(EXAMPLE_ID_PREFIX.length)}`) : makeId();
}

/** Cards for the kudos not on the board yet, in `columnKey`, in the order given. */
export function kudosCards(
  kudos: readonly SprintKudos[],
  cards: readonly RetroCard[],
  columnKey: string
): RetroCard[] {
  const already = kudosOnBoard(cards);
  const out: RetroCard[] = [];
  for (const k of kudos) {
    if (already.has(k.id)) continue;
    already.add(k.id);
    out.push({
      id: cardIdFor(k),
      columnKey,
      text: kudosCardText(k),
      votes: 0,
      groupedWith: null,
      isActionItem: false,
      assignee: "",
      discussing: false,
      sourceRef: { tool: KUDOS_TOOL, id: k.id },
    });
  }
  return out;
}
