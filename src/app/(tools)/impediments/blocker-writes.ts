/**
 * Impediment Tracker: writing a cluster on many blockers at once and taking
 * it back. A blocker is an impediment (its `cluster` and `blockSide`) or a
 * blocked spell on a story or a Flow-board card (its note, through the
 * base's `withSpellNote`). One write per collection: the impediments that
 * change, the stories that change, and the board when a card does. Pure.
 */

import type {
  BlockSide,
  Impediment,
  KanbanBoard,
  KanbanCard,
  Story,
} from "@/lib/stores/workspace-types";
import { withSpellNote } from "@/lib/flow/block-stamps";
import { cleanClusterName, withImpedimentCluster } from "@/lib/impediments/blockers";

/** Which blocker a cluster goes on. */
export interface ClusterTarget {
  kind: "impediment" | "story" | "card";
  id: string;
  /** A spell's start (stories and cards). */
  spellFrom?: string;
}

/**
 * A cluster to write on one blocker: null clears it (and its side). `side`
 * sets the side; null clears it; left out keeps it.
 */
export interface ClusterChange extends ClusterTarget {
  cluster: string | null;
  side?: BlockSide | null;
}

/** What a blocker held before a write, and the cluster the write put there. */
export interface ClusterBefore extends ClusterTarget {
  cluster: string | null;
  side: BlockSide | null;
  wrote: string | null;
}

export interface ClusterWrite {
  impediments: Impediment[];
  stories: Story[];
  board: KanbanBoard | null;
  before: ClusterBefore[];
}

export interface BlockerData {
  impediments: readonly Impediment[];
  stories: readonly Story[];
  board: KanbanBoard | null;
}

type Spelled = Pick<Story, "id" | "blockLog" | "blocked">;

function spellAt(row: Spelled | undefined, from: string | undefined) {
  if (!row || from === undefined) return undefined;
  return (row.blockLog ?? []).find((s) => s.from === from);
}

/** The start of the spell a note without `spellFrom` lands on: the open one, else the newest. */
function notedFrom(row: Spelled): string | undefined {
  const log = row.blockLog ?? [];
  for (let i = log.length - 1; i >= 0; i--) if (log[i].to === undefined) return log[i].from;
  return log[log.length - 1]?.from;
}

/** `cluster` and `side` on every target: one cluster for many blockers. */
export function sameCluster(
  targets: readonly ClusterTarget[],
  cluster: string | null,
  side?: BlockSide
): ClusterChange[] {
  return targets.map((t) => ({ ...t, cluster, ...(side ? { side } : {}) }));
}

/** The writes for `changes`, and what each blocker held before. Blockers already as asked are left out. */
export function clusterWrite(data: BlockerData, changes: readonly ClusterChange[]): ClusterWrite {
  const impById = new Map(data.impediments.map((i) => [i.id, i]));
  const storyById = new Map(data.stories.map((s) => [s.id, s]));
  const impediments = new Map<string, Impediment>();
  const stories = new Map<string, Story>();
  const cards: KanbanCard[] | null = data.board ? [...data.board.cards] : null;
  let cardsChanged = false;
  const before: ClusterBefore[] = [];

  for (const c of changes) {
    const name = c.cluster === null ? null : cleanClusterName(c.cluster) || null;
    if (c.kind === "impediment") {
      const row = impediments.get(c.id) ?? impById.get(c.id);
      if (!row) continue;
      let next = withImpedimentCluster(row, name, c.side ?? undefined);
      if (name && c.side === null && next.blockSide !== undefined) {
        next = { ...next };
        delete next.blockSide;
      }
      if (next === row) continue;
      before.push({
        kind: c.kind,
        id: c.id,
        cluster: row.cluster ?? null,
        side: row.blockSide ?? null,
        wrote: next.cluster ?? null,
      });
      impediments.set(c.id, next);
      continue;
    }
    const note = name === null ? { cluster: "", side: null } : { cluster: name, side: c.side };
    const opts = c.spellFrom ? { spellFrom: c.spellFrom } : {};
    const apply = <T extends Spelled>(row: T): T | null => {
      const next = withSpellNote(row, note, opts);
      if (!next || next === row) return null;
      const from = c.spellFrom ?? notedFrom(next);
      const prev = spellAt(row, from);
      before.push({
        kind: c.kind,
        id: c.id,
        ...(from ? { spellFrom: from } : {}),
        cluster: prev?.cluster ?? null,
        side: prev?.side ?? null,
        wrote: name,
      });
      return next;
    };
    if (c.kind === "story") {
      const row = stories.get(c.id) ?? storyById.get(c.id);
      const next = row ? apply(row) : null;
      if (next) stories.set(c.id, next);
      continue;
    }
    const at = cards ? cards.findIndex((card) => card.id === c.id) : -1;
    if (!cards || at < 0) continue;
    const next = apply(cards[at]);
    if (next) {
      cards[at] = next;
      cardsChanged = true;
    }
  }
  return {
    impediments: Array.from(impediments.values()),
    stories: Array.from(stories.values()),
    board: cardsChanged && data.board && cards ? { ...data.board, cards } : null,
    before,
  };
}

/**
 * The changes that put back what `before` held, for the blockers still
 * holding the cluster the write put there: one changed since is left alone.
 */
export function undoChanges(before: readonly ClusterBefore[], data: BlockerData): ClusterChange[] {
  const impById = new Map(data.impediments.map((i) => [i.id, i]));
  const storyById = new Map(data.stories.map((s) => [s.id, s]));
  const cardById = new Map((data.board?.cards ?? []).map((c) => [c.id, c]));
  const out: ClusterChange[] = [];
  for (const b of before) {
    const now =
      b.kind === "impediment"
        ? (impById.get(b.id)?.cluster ?? null)
        : (spellAt(b.kind === "story" ? storyById.get(b.id) : cardById.get(b.id), b.spellFrom)
            ?.cluster ?? null);
    if (now !== b.wrote) continue;
    out.push({
      kind: b.kind,
      id: b.id,
      ...(b.spellFrom ? { spellFrom: b.spellFrom } : {}),
      cluster: b.cluster,
      side: b.side,
    });
  }
  return out;
}
