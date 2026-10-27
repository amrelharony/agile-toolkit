"use client";

/**
 * "Copy into my browser" for snapshot links.
 *
 * A snapshot always carries the tool's Markdown (what the /s page shows) and,
 * for the tools below, the structured state it was made from. Importing
 * never overwrites the visitor's own work: a retro arrives as a past retro,
 * scored items and objectives are added alongside theirs with new ids, and
 * a story map (one document per browser) replaces theirs only after they
 * confirm, with Undo.
 *
 * The state comes from a link anyone could have crafted, so each importer
 * validates the shape strictly and copies only known fields.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KR_CHECK_IN_CAP,
  type KeyResult,
  type KeyResultCheckIn,
  type Okr,
  type PrioritizationItem,
  type RetroBoard,
  type RetroCard,
  type StoryMap,
  type StoryMapCard,
} from "@/lib/stores/workspace-types";
import {
  RETRO_ARCHIVE_LIMIT,
  archivedRetroCopy,
  retroArchivesToPrune,
} from "@/app/(tools)/retro/archive";
import { STORY_MAP_ID } from "@/lib/stores/workspace-types";

export interface SnapshotImporter {
  /** What "Copy into my browser" will do, in one sentence. */
  describe: string;
  /** Replaces the visitor's current document (ask first). */
  replaces?: boolean;
  /** Where to go afterwards. */
  href: string;
  /** Validate and import. Returns how to undo it, or null when the state isn't valid. */
  importState: (state: unknown) => (() => void) | null;
}

const isStr = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = (v: unknown, max = 500): v is unknown[] => Array.isArray(v) && v.length <= max;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

// ── Retro ────────────────────────────────────────────────────────────────

export function readRetro(state: unknown): RetroBoard | null {
  const s = obj(state);
  const format = obj(s?.format);
  if (!s || !format || !isStr(format.name, 200) || !isArr(format.columns, 12) || !isArr(s.cards)) {
    return null;
  }
  const columns = format.columns.map(obj);
  if (columns.some((c) => !c || !isStr(c.key, 64) || !isStr(c.label, 200))) return null;
  const cards: RetroCard[] = [];
  for (const raw of s.cards) {
    const c = obj(raw);
    if (!c || !isStr(c.id, 64) || !isStr(c.columnKey, 64) || !isStr(c.text) || !isNum(c.votes))
      return null;
    cards.push({
      id: c.id,
      columnKey: c.columnKey,
      text: c.text,
      votes: Math.max(0, Math.min(999, Math.round(c.votes))),
      groupedWith: isStr(c.groupedWith, 64) ? c.groupedWith : null,
      isActionItem: c.isActionItem === true,
      assignee: isStr(c.assignee, 200) ? c.assignee : "",
      discussing: false,
    });
  }
  return {
    id: "retro:shared",
    format: {
      id: isStr(format.id, 64) ? format.id : "shared",
      name: format.name,
      description: isStr(format.description, 500) ? format.description : "",
      columns: columns.map((c) => ({
        key: c!.key as string,
        label: c!.label as string,
        color: isStr(c!.color, 64) ? (c!.color as string) : "accent",
        icon: isStr(c!.icon, 16) ? (c!.icon as string) : "",
      })),
    },
    phase: "actions",
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
  };
}

// ── Prioritization rows (WSJF, RICE) ─────────────────────────────────────

function readRows(
  state: unknown,
  framework: PrioritizationItem["framework"]
): PrioritizationItem[] | null {
  if (!isArr(state, 200)) return null;
  const now = new Date().toISOString();
  const rows: PrioritizationItem[] = [];
  for (const raw of state) {
    const r = obj(raw);
    if (!r || !isStr(r.title, 300) || r.framework !== framework) return null;
    const fields: Record<string, number | string> = {};
    const f = obj(r.fields);
    if (f) {
      for (const [k, v] of Object.entries(f).slice(0, 30)) {
        if (isStr(k, 40) && (isNum(v) || isStr(v, 300))) fields[k] = v;
      }
    }
    rows.push({
      id: `${framework}-${nanoid(8)}`,
      framework,
      title: r.title,
      ...(isStr(r.description) ? { description: r.description } : {}),
      ...(isNum(r.score) ? { score: r.score } : {}),
      fields,
      updatedAt: now,
    });
  }
  return rows;
}

// ── OKRs ─────────────────────────────────────────────────────────────────

const isConfidence = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 10;

/**
 * A key result's dated check-ins (Phase 8): each with a "YYYY-MM-DD" date
 * and a finite value, a 0–10 confidence and a short note kept when valid,
 * a new id. Oldest first, at most KR_CHECK_IN_CAP (the newest kept), as the
 * OKR page keeps them. Invalid entries are left out; none valid: absent.
 */
function readCheckIns(raw: unknown): KeyResultCheckIn[] | undefined {
  if (!isArr(raw)) return undefined;
  const out: KeyResultCheckIn[] = [];
  for (const entry of raw) {
    const c = obj(entry);
    if (!c || !isStr(c.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(c.date) || !isNum(c.value)) {
      continue;
    }
    out.push({
      id: `ci-${nanoid(8)}`,
      date: c.date,
      value: c.value,
      ...(isConfidence(c.confidence) ? { confidence: c.confidence } : {}),
      ...(isStr(c.note, 500) ? { note: c.note } : {}),
    });
  }
  if (out.length === 0) return undefined;
  // A stable sort: same-day check-ins keep the order they were sent in.
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.slice(-KR_CHECK_IN_CAP);
}

function readOkrs(state: unknown): Okr[] | null {
  if (!isArr(state, 50)) return null;
  const out: Okr[] = [];
  for (const raw of state) {
    const o = obj(raw);
    if (!o || !isStr(o.objective, 500) || !isStr(o.quarter, 40) || !isArr(o.keyResults, 20))
      return null;
    const krs: KeyResult[] = [];
    for (const k of o.keyResults) {
      const kr = obj(k);
      if (!kr || !isStr(kr.title, 500) || !isNum(kr.target) || !isNum(kr.current)) return null;
      const checkIns = readCheckIns(kr.checkIns);
      krs.push({
        id: `kr-${nanoid(8)}`,
        title: kr.title,
        target: kr.target,
        current: kr.current,
        ...(isStr(kr.unit, 40) ? { unit: kr.unit } : {}),
        ...(isConfidence(kr.confidence) ? { confidence: kr.confidence } : {}),
        ...(isStr(kr.description) ? { description: kr.description } : {}),
        // Phase 8: without these a "decrease" key result (baseline 22 →
        // target 15) would import as an "increase" from 0.
        ...(isNum(kr.baseline) ? { baseline: kr.baseline } : {}),
        ...(kr.direction === "increase" || kr.direction === "decrease"
          ? { direction: kr.direction }
          : {}),
        ...(checkIns ? { checkIns } : {}),
      });
    }
    out.push({
      id: `okr-${nanoid(8)}`,
      objective: o.objective,
      quarter: o.quarter,
      keyResults: krs,
      ...(isStr(o.description) ? { description: o.description } : {}),
      ...(isStr(o.owner, 200) ? { owner: o.owner } : {}),
    });
  }
  return out;
}

// ── Story map ────────────────────────────────────────────────────────────

export { STORY_MAP_ID };

function readStoryMap(state: unknown): StoryMap | null {
  const s = obj(state);
  if (!s || !isArr(s.steps, 50) || !isArr(s.slices, 30)) return null;
  const steps = s.steps.map(obj);
  if (steps.some((st) => !st || !isStr(st.id, 64) || !isStr(st.name, 200))) return null;
  const stepIds = new Set(steps.map((st) => st!.id as string));
  const slices: StoryMap["slices"] = [];
  for (const raw of s.slices) {
    const sl = obj(raw);
    const cardsByStep = obj(sl?.cards);
    if (!sl || !isStr(sl.id, 64) || !isStr(sl.name, 200) || !cardsByStep) return null;
    const cards: Record<string, StoryMapCard[]> = {};
    for (const [stepId, list] of Object.entries(cardsByStep)) {
      if (!stepIds.has(stepId) || !isArr(list, 100)) return null;
      cards[stepId] = [];
      for (const rc of list) {
        const c = obj(rc);
        if (!c || !isStr(c.id, 64) || !isStr(c.title, 300)) return null;
        cards[stepId].push({
          id: c.id,
          title: c.title,
          description: isStr(c.description) ? c.description : "",
          color: isStr(c.color, 32) ? c.color : "blue",
          ...(isStr(c.estimate, 16) ? { estimate: c.estimate } : {}),
        });
      }
    }
    slices.push({ id: sl.id, name: sl.name, cards });
  }
  return {
    id: STORY_MAP_ID,
    steps: steps.map((st) => ({ id: st!.id as string, name: st!.name as string })),
    slices,
  };
}

// ── Registry ─────────────────────────────────────────────────────────────

const ws = () => useWorkspaceStore.getState();

export const SNAPSHOT_IMPORTERS: Record<string, SnapshotImporter> = {
  retro: {
    describe: `Adds this retro to Past retros in your browser (with ${RETRO_ARCHIVE_LIMIT} there already, the oldest makes room). Your current board isn't touched.`,
    href: "/retro",
    importState(state) {
      const board = readRetro(state);
      if (!board) return null;
      const boards = ws().retroBoards ?? [];
      const pruneIds = new Set(retroArchivesToPrune(boards));
      // Kept so Undo puts back the past retros the copy made room for.
      const pruned = boards.filter((b) => pruneIds.has(b.id));
      for (const b of pruned) ws().removeRetroBoard(b.id);
      const copy = archivedRetroCopy(board);
      ws().upsertRetroBoard(copy);
      return () => {
        ws().removeRetroBoard(copy.id);
        for (const b of pruned) ws().upsertRetroBoard(b);
      };
    },
  },
  wsjf: {
    describe: "Adds these features to your WSJF list, next to your own.",
    href: "/wsjf",
    importState(state) {
      const rows = readRows(state, "wsjf");
      if (!rows) return null;
      rows.forEach((r) => ws().upsertPrioritization(r));
      return () => rows.forEach((r) => ws().removePrioritization(r.id));
    },
  },
  "rice-scoring": {
    describe: "Adds these initiatives to your RICE list, next to your own.",
    href: "/rice-scoring",
    importState(state) {
      const rows = readRows(state, "rice");
      if (!rows) return null;
      rows.forEach((r) => ws().upsertPrioritization(r));
      return () => rows.forEach((r) => ws().removePrioritization(r.id));
    },
  },
  okrs: {
    describe: "Adds these objectives and key results to your OKRs, next to your own.",
    href: "/okrs",
    importState(state) {
      const okrs = readOkrs(state);
      if (!okrs) return null;
      okrs.forEach((o) => ws().upsertOkr(o));
      return () => okrs.forEach((o) => ws().removeOkr(o.id));
    },
  },
  "story-mapper": {
    describe: "Replaces the story map in your browser with this one. You can undo it.",
    replaces: true,
    href: "/story-mapper",
    importState(state) {
      const map = readStoryMap(state);
      if (!map) return null;
      const before = currentStoryMap();
      ws().upsertStoryMap(map);
      return () => (before ? ws().upsertStoryMap(before) : ws().removeStoryMap(STORY_MAP_ID));
    },
  },
};

/** The current story map, for Undo after a replacing import. */
export function currentStoryMap(): StoryMap | undefined {
  return (ws().storyMaps ?? []).find((m) => m.id === STORY_MAP_ID);
}

/** Validation only, for tests and for deciding whether to offer the button. */
export const snapshotValidators = { readRetro, readRows, readOkrs, readStoryMap };
