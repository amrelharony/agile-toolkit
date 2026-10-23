import { isExampleId } from "@/components/tool-frame/example-data";
import {
  findLink,
  getHandoffRoute,
  liveLink,
  withLink,
  withoutLink,
} from "@/lib/handoffs/registry";
import type { HandoffSource } from "@/lib/handoffs/types";
import type {
  HandoffLink,
  StoryMapCard,
  StoryMapSlice,
  StoryMapStep,
} from "@/lib/stores/workspace-types";
import { estimatePoints, sliceCards } from "./estimate";

/** The story map's one document id. MUST match SM_ID in story-mapper-client.tsx. */
export const SM_ID = "story-mapper:current";

const ROUTE = "backlog-story" as const;

/** Whether the card is in the backlog: sent there, and that story still exists. */
export function inBacklog(card: StoryMapCard): boolean {
  return Boolean(liveLink(card.sentTo, ROUTE));
}

/** What a card hands the backlog: its title, and its estimate when it's in points. */
export function backlogSource(card: StoryMapCard): HandoffSource {
  return {
    title: card.title,
    description: card.description || undefined,
    points: estimatePoints(card.estimate),
    sourceRef: { tool: "story-mapper", id: card.id, doc: SM_ID },
  };
}

/**
 * The cards "Send to backlog" would add for a slice: under today's steps,
 * titled, not yet in the backlog, and the user's own. Example cards stay
 * on the map, so loading the example never writes stories into the real
 * backlog.
 */
export function cardsToSend(slice: StoryMapSlice, steps: readonly StoryMapStep[]): StoryMapCard[] {
  return sliceCards(slice, steps).filter(
    (c) => !isExampleId(c.id) && c.title.trim() !== "" && !inBacklog(c)
  );
}

/** One card's send: the new link, and the dead link it replaced (back on Undo). */
export interface SentCard {
  link: HandoffLink;
  previous?: HandoffLink;
}

/**
 * Create a backlog story for each card and return the links to record,
 * keyed by card id. Callers wrap this in one `undoable()` and pass the
 * result to `unsendCards` for the Undo, so a whole slice comes back as one
 * step instead of one toast per card.
 */
export function sendCards(cards: readonly StoryMapCard[], at: string): Map<string, SentCard> {
  const route = getHandoffRoute(ROUTE);
  const sent = new Map<string, SentCard>();
  for (const card of cards) {
    sent.set(card.id, {
      link: { route: ROUTE, targetId: route.send(backlogSource(card)), at },
      previous: findLink(card.sentTo, ROUTE),
    });
  }
  return sent;
}

/** Undo `sendCards`: remove the stories it made. */
export function unsendCards(sent: ReadonlyMap<string, SentCard>): void {
  const route = getHandoffRoute(ROUTE);
  sent.forEach(({ link }) => route.remove(link.targetId));
}

/** A card's links with the send recorded. */
export function linksAfterSend(card: StoryMapCard, s: SentCard): HandoffLink[] {
  return withLink(card.sentTo, s.link);
}

/** A card's links with the send taken back (and any link it replaced restored). */
export function linksAfterUnsend(card: StoryMapCard, s: SentCard): HandoffLink[] {
  const rest = withoutLink(card.sentTo, s.link);
  return s.previous && !findLink(rest, ROUTE) ? [...rest, s.previous] : rest;
}
