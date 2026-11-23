/**
 * Flow Insights: the page's pure pieces. The numbers come from
 * lib/flow/distribution and stability (shared with Amr's verbs); what's
 * here is how the page writes a type on many rows at once and takes it back,
 * the bar segments and their words, and the AI input with short ids.
 */

import type {
  CapacityPlan,
  KanbanBoard,
  KanbanCard,
  Sprint,
  Story,
  WorkDemand,
  WorkflowDefinition,
  WorkType,
} from "@/lib/stores/workspace-types";
import { WORK_TYPES } from "@/lib/stores/workspace-types";
import { WORK_TYPE_LABEL } from "@/lib/flow/work-types";
import { sourceToolOf, type MixItem, type MixPeriod } from "@/lib/flow/distribution";
import {
  CLASSIFY_FROM_MAX,
  CLASSIFY_ITEMS_MAX,
  CLASSIFY_TAGS_MAX,
  CLASSIFY_TAG_MAX,
  CLASSIFY_TEXT_MAX,
  CLASSIFY_TITLE_MAX,
  type ClassifyInput,
} from "@/lib/ai/tasks/flow-insights.lite";
import { cutText } from "@/lib/utils/cut-text";

/** What the page reads: the workspace's rows, or the example's in-memory copy. */
export interface FlowData {
  stories: Story[];
  sprints: Sprint[];
  /** The Flow board (KANBAN_BOARD_ID), or null without one. */
  board: KanbanBoard | null;
  plans: CapacityPlan[];
  workflow: WorkflowDefinition | null;
}

/** Which row a change is for. */
export interface RowRef {
  kind: "story" | "card";
  id: string;
}

/** A type (and maybe a demand) to write on a row: null clears, left out keeps. */
export interface TypeChange extends RowRef {
  type?: WorkType | null;
  demand?: WorkDemand | null;
}

/** What a row held before a change, to put back. */
export interface TypeBefore extends RowRef {
  type: WorkType | undefined;
  demand: WorkDemand | undefined;
  /** What the change wrote, so Undo leaves a row changed since alone. */
  wroteType: WorkType | undefined;
  wroteDemand: WorkDemand | undefined;
}

function applyChange<T extends { workType?: WorkType; demand?: WorkDemand }>(
  row: T,
  c: Pick<TypeChange, "type" | "demand">
): T {
  const next = { ...row };
  if (c.type === null) delete next.workType;
  else if (c.type !== undefined) next.workType = c.type;
  if (c.demand === null) delete next.demand;
  else if (c.demand !== undefined) next.demand = c.demand;
  return next.workType === row.workType && next.demand === row.demand ? row : next;
}

/** The writes for `changes`: the stories that change, the board when a card does, and what they held. */
export interface TypeWrite {
  stories: Story[];
  board: KanbanBoard | null;
  before: TypeBefore[];
}

/**
 * The rows `changes` touch, with the change made (one list of stories for
 * one store write, the whole board when a card changes), and what each
 * held before. Rows already as asked are left out.
 */
export function typeWrite(
  stories: readonly Story[],
  board: KanbanBoard | null,
  changes: readonly TypeChange[]
): TypeWrite {
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const out: Story[] = [];
  const before: TypeBefore[] = [];
  const cardChanges = new Map<string, TypeChange>();
  for (const c of changes) {
    if (c.kind === "card") {
      cardChanges.set(c.id, c);
      continue;
    }
    const row = storyById.get(c.id);
    if (!row) continue;
    const next = applyChange(row, c);
    if (next === row) continue;
    out.push(next);
    storyById.set(c.id, next);
    before.push(beforeOf(c, row, next));
  }
  let nextBoard: KanbanBoard | null = null;
  if (board && cardChanges.size > 0) {
    let changed = false;
    const cards = board.cards.map((card) => {
      const c = cardChanges.get(card.id);
      if (!c) return card;
      const next = applyChange(card, c);
      if (next === card) return card;
      changed = true;
      before.push(beforeOf(c, card, next));
      return next;
    });
    if (changed) nextBoard = { ...board, cards };
  }
  return { stories: out, board: nextBoard, before };
}

function beforeOf(
  ref: RowRef,
  row: { workType?: WorkType; demand?: WorkDemand },
  next: { workType?: WorkType; demand?: WorkDemand }
): TypeBefore {
  return {
    kind: ref.kind,
    id: ref.id,
    type: row.workType,
    demand: row.demand,
    wroteType: next.workType,
    wroteDemand: next.demand,
  };
}

/**
 * The changes that put back what `before` held, for the rows still holding
 * what the write wrote: a row changed since (by hand, on another device or
 * by Amr) is left as it is now.
 */
export function undoChanges(
  before: readonly TypeBefore[],
  stories: readonly Story[],
  board: KanbanBoard | null
): TypeChange[] {
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const cardById = new Map((board?.cards ?? []).map((c) => [c.id, c]));
  const out: TypeChange[] = [];
  for (const b of before) {
    const row: Story | KanbanCard | undefined =
      b.kind === "story" ? storyById.get(b.id) : cardById.get(b.id);
    if (!row || row.workType !== b.wroteType || row.demand !== b.wroteDemand) continue;
    out.push({ kind: b.kind, id: b.id, type: b.type ?? null, demand: b.demand ?? null });
  }
  return out;
}

/* ── Bars ─────────────────────────────────────────────────────────────── */

export type SegmentKey = WorkType | "unsorted";

export const SEGMENT_LABEL: Record<SegmentKey, string> = {
  ...WORK_TYPE_LABEL,
  unsorted: "Not sorted",
};

/** Each kind's colour in the bars and the legend (theme tokens; words say the split too). */
export const SEGMENT_SWATCH: Record<SegmentKey, string> = {
  feature: "bg-accent",
  defect: "bg-danger",
  debt: "bg-warning",
  risk: "bg-info",
  unsorted: "bg-sub",
};

export interface Segment {
  key: SegmentKey;
  count: number;
  /** Of these, guessed (not set on the item). */
  guessed: number;
  /** Share of the period's finished work, 0–100 (not rounded). */
  pct: number;
}

/** A period's bar: one segment per kind with work, then "Not sorted". */
export function segmentsOf(p: MixPeriod): Segment[] {
  if (p.finished === 0) return [];
  const keys: SegmentKey[] = [...WORK_TYPES, "unsorted"];
  return keys
    .map((key) => {
      const items = p.items.filter((it) => (key === "unsorted" ? !it.type : it.type === key));
      return {
        key,
        count: items.length,
        guessed: items.filter((it) => it.type && it.typeBy !== "set").length,
        pct: (items.length / p.finished) * 100,
      };
    })
    .filter((s) => s.count > 0);
}

/** A bar's split in words: "Feature 6 (2 guessed), Defect 2, Not sorted 1". */
export function splitWords(p: MixPeriod): string {
  const parts = segmentsOf(p).map(
    (s) => `${SEGMENT_LABEL[s.key]} ${s.count}${s.guessed ? ` (${s.guessed} guessed)` : ""}`
  );
  return parts.length ? parts.join(", ") : "Nothing finished";
}

/* ── The AI input ─────────────────────────────────────────────────────── */

/** The items to send, with short ids ("i1" …), and the map back to the rows. */
export interface ClassifyPlan {
  input: ClassifyInput;
  byShortId: Map<string, RowRef>;
}

const cut = (s: string, max: number) => cutText(s.replace(/\s+/g, " ").trim(), max).trim();

/**
 * The AI input for `items` (at most CLASSIFY_ITEMS_MAX): each under a short
 * id, so row ids never leave the browser; a story's tags, a card's
 * description, the tool it was sent from, and whether it was reopened.
 */
export function classifyPlan(
  items: readonly MixItem[],
  stories: readonly Story[],
  cards: readonly KanbanCard[]
): ClassifyPlan {
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const byShortId = new Map<string, RowRef>();
  const list: ClassifyInput["items"] = [];
  for (const it of items.slice(0, CLASSIFY_ITEMS_MAX)) {
    const row = it.kind === "story" ? storyById.get(it.id) : cardById.get(it.id);
    if (!row) continue;
    const id = `i${list.length + 1}`;
    byShortId.set(id, { kind: it.kind, id: it.id });
    const tags =
      it.kind === "story" && Array.isArray((row as Story).tags)
        ? ((row as Story).tags as string[])
            .filter((t) => typeof t === "string" && t.trim())
            .slice(0, CLASSIFY_TAGS_MAX)
            .map((t) => cut(t, CLASSIFY_TAG_MAX))
        : [];
    const rawText = it.kind === "card" ? (row as KanbanCard).description : (row as Story).notes;
    const text = typeof rawText === "string" ? cut(rawText, CLASSIFY_TEXT_MAX) : "";
    const from = sourceToolOf(row);
    list.push({
      id,
      title: cut(it.title, CLASSIFY_TITLE_MAX) || "Untitled",
      ...(text ? { text } : {}),
      tags,
      ...(from ? { from: cut(from, CLASSIFY_FROM_MAX) } : {}),
      reopened: it.reopened,
    });
  }
  return { input: { items: list }, byShortId };
}
