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
import type {
  KeyResult,
  KeyResultCheckIn,
  Okr,
  PrioritizationItem,
  RetroBoard,
  RetroCard,
  StoryMap,
  StoryMapCard,
} from "@/lib/stores/workspace-types";
import {
  RETRO_ARCHIVE_LIMIT,
  archivedRetroCopy,
  retroArchivesToPrune,
} from "@/app/(tools)/retro/archive";
import { STORY_MAP_ID } from "@/lib/stores/workspace-types";
import { RETRO_COLUMN_PALETTE } from "@/lib/constants/retro-formats";
import { isRetroVotes } from "@/lib/retro/board";
import { themed } from "@/lib/utils/theme-color";
import { latestCheckInDay, withCheckIn } from "@/lib/okrs/progress";
import { isIsoDate } from "@/lib/sprints/calendar";
import { todayLocalISO } from "@/lib/utils/formatters";

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

/**
 * A column's colour from a link: one of the app's brand colours (what the
 * built-in formats and a custom format's palette use, which `themed()` maps
 * onto each theme), else the palette's colour for its place. So a crafted
 * link's colour never reaches a style.
 */
function linkColumnColor(raw: unknown, index: number): string {
  if (typeof raw === "string" && raw.length <= 64 && themed(raw) !== raw) return raw;
  return RETRO_COLUMN_PALETTE[index % RETRO_COLUMN_PALETTE.length];
}

/**
 * A shared retro: any format, a custom one included (up to 12 columns),
 * with its cards and the votes each person had. It lands as a past retro.
 */
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
      columns: columns.map((c, i) => ({
        key: c!.key as string,
        label: c!.label as string,
        color: linkColumnColor(c!.color, i),
        icon: isStr(c!.icon, 16) ? (c!.icon as string) : "",
      })),
    },
    phase: "actions",
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...(isRetroVotes(s.votesPerPerson) ? { votesPerPerson: s.votesPerPerson } : {}),
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
 * A key result's dated check-ins (Phase 8), in the order sent: each with a
 * real "YYYY-MM-DD" day no later than `latest` and a finite value, a 0–10
 * confidence and a short note kept when valid, a new id. Invalid and
 * future-dated entries are left out, as the OKR page refuses them.
 */
function readCheckIns(raw: unknown, latest: string): KeyResultCheckIn[] {
  if (!isArr(raw)) return [];
  const out: KeyResultCheckIn[] = [];
  for (const entry of raw) {
    const c = obj(entry);
    if (
      !c ||
      !isStr(c.date, 10) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
      !isIsoDate(c.date) ||
      c.date > latest ||
      !isNum(c.value)
    ) {
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
  return out;
}

function readOkrs(state: unknown): Okr[] | null {
  if (!isArr(state, 50)) return null;
  // The check-ins were dated on the sharer's clock, whose today can be a day
  // ahead of the visitor's: tomorrow is still taken, as tool.okrs.check_in
  // takes it over MCP, so the link's newest check-in isn't lost.
  const latest = latestCheckInDay(todayLocalISO(), true);
  const out: Okr[] = [];
  for (const raw of state) {
    const o = obj(raw);
    if (!o || !isStr(o.objective, 500) || !isStr(o.quarter, 40) || !isArr(o.keyResults, 20))
      return null;
    const krs: KeyResult[] = [];
    for (const k of o.keyResults) {
      const kr = obj(k);
      if (!kr || !isStr(kr.title, 500) || !isNum(kr.target) || !isNum(kr.current)) return null;
      const read: KeyResult = {
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
      };
      // Recorded as the OKR page records them (lib/okrs withCheckIn): oldest
      // first (same-day ones in the order sent), at most KR_CHECK_IN_CAP with
      // the newest kept, and current and confidence mirrored from the newest,
      // so a link that disagrees with its own history can't import a stale
      // current. None valid: no check-ins, and the key result as sent.
      krs.push(readCheckIns(kr.checkIns, latest).reduce(withCheckIn, read));
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
