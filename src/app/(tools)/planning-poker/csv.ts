/**
 * Planning Poker's results as a spreadsheet: one row per story with the
 * column a tracker needs to find it (its ticket key, or its title when it
 * has none), the summary and the agreed estimate. The Export menu's CSV
 * option reads it, so the estimates can go back into a tracker without
 * retyping them.
 *
 * A session story has no ticket key of its own: the key is the backlog
 * story's it came from, found through this browser's queue, the estimates
 * the queue's write-back logged, and the stories "Save to backlog" made.
 * A guest's browser has none of those, so its rows fall back to the title.
 *
 * The rows are imported into a tracker by key, so a key is only given to
 * the story it belongs to: stories are matched by id, never by a title two
 * of them can share. A row without a sure match keeps its title.
 */

import type {
  PokerEstimate,
  PokerQueueItem,
  Story as WorkspaceStory,
} from "@/lib/stores/workspace-types";
import { STORY_QUEUE_TOOL } from "@/lib/handoffs/targets/poker-queue";
import { savedStoryFor } from "./backlog";
import { isNumeric } from "./rounds";
import type { Session, Story as SessionStory } from "./types";

export const POKER_CSV_HEADERS = ["Ticket key or title", "Summary", "Story points"];

/** One line, trimmed: a title pasted with a line break stays one cell line. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

const titleKey = (title: string) => oneLine(title).replace(/\s+/g, " ").toLowerCase();

export interface TicketKeySources {
  /** The Planning Poker queue (stories other tools sent). */
  queue?: readonly PokerQueueItem[];
  /** The estimates the queue's write-back logged, oldest first. */
  estimates?: readonly PokerEstimate[];
  /** The workspace's stories. */
  stories: readonly WorkspaceStory[];
  /**
   * The session stories this browser pulled in from the queue. Only these
   * may be matched by title, against an estimate logged before the log kept
   * the session story's id.
   */
  fromQueue?: ReadonlySet<string>;
}

/**
 * The ticket key of each session story that has one, by session story id.
 * A story still on the queue is matched by the id the queue stamped on it;
 * one already estimated has left the queue, so it is matched by the same id
 * the write-back logged with its estimate; one typed here and saved to the
 * backlog is matched by the link the save made.
 *
 * An estimate logged before the log kept that id can only be matched by
 * title. That is done for a story known to come from the queue (`fromQueue`)
 * and only when every such estimate with the title is for one story: with
 * two, the key would be a guess.
 */
export function sessionTicketKeys(
  sessionStories: readonly SessionStory[],
  { queue = [], estimates = [], stories, fromQueue }: TicketKeySources
): Map<string, string> {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const keyOf = (storyId: string | null | undefined) =>
    (storyId ? byId.get(storyId)?.ticketKey?.trim() : undefined) || undefined;

  /** Session story id to the workspace story it came from. */
  const source = new Map<string, string>();
  /** Title to the one story the older estimates name for it (null: more than one). */
  const byTitle = new Map<string, string | null>();
  for (const e of estimates) {
    if (e.sourceRef?.tool !== STORY_QUEUE_TOOL) continue;
    if (typeof e.sessionStoryId === "string" && e.sessionStoryId) {
      source.set(e.sessionStoryId, e.sourceRef.id);
      continue;
    }
    if (typeof e.storyTitle !== "string" || !byId.has(e.sourceRef.id)) continue;
    const title = titleKey(e.storyTitle);
    const known = byTitle.get(title);
    byTitle.set(title, known === undefined || known === e.sourceRef.id ? e.sourceRef.id : null);
  }
  // Still on the queue (not estimated yet, or queued again since).
  for (const q of queue) {
    if (q.sessionStoryId && q.sourceRef.tool === STORY_QUEUE_TOOL) {
      source.set(q.sessionStoryId, q.sourceRef.id);
    }
  }

  const keys = new Map<string, string>();
  for (const st of sessionStories) {
    const key =
      keyOf(source.get(st.id)) ??
      keyOf(savedStoryFor(stories, st.id)?.id) ??
      (fromQueue?.has(st.id) ? keyOf(byTitle.get(titleKey(st.title))) : undefined);
    if (key) keys.set(st.id, key);
  }
  return keys;
}

/**
 * The session's stories as CSV rows, in the session's order: ticket key (the
 * title when the story has none), summary, and the accepted estimate. A
 * numeric estimate is a number; a T-shirt size stays as written; a story not
 * estimated yet has a blank cell. Undefined when there is nothing to export.
 */
export function pokerCsv(
  session: Session | null,
  ticketKeys: ReadonlyMap<string, string> = new Map()
): { headers: string[]; rows: (string | number)[][] } | undefined {
  if (!session || session.stories.length === 0) return undefined;
  return {
    headers: POKER_CSV_HEADERS,
    rows: session.stories.map((st) => {
      const summary = oneLine(st.title);
      const estimate = st.finalEstimate?.trim() ?? "";
      return [
        ticketKeys.get(st.id) ?? summary,
        summary,
        estimate && isNumeric(estimate) ? Number(estimate) : estimate,
      ];
    }),
  };
}
