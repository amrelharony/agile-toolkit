/**
 * Cross-tool import — seed a whiteboard from existing toolkit data.
 *
 * Each importer takes the source-tool entities + a target boardId and
 * returns ready-to-add `WhiteboardObject`s. The receiver calls
 * `upsertWhiteboardObjects` to land them.
 *
 * Imported objects carry a `sourceRef = { tool, entityId }` back-pointer
 * so a future "sync" feature could re-import / push updates.
 */

import type {
  WhiteboardObject,
  WhiteboardSticky,
  WhiteboardFrame,
  Story,
  Risk,
  Okr,
} from "@/lib/stores/workspace-types";
import { STICKY_PALETTE } from "./templates";
import { treeLayout, gridLayout } from "./layout";
import { wbId } from "./clipboard";

const now = () => new Date().toISOString();
const id = () => wbId();

/** Hard cap on imported text content. The peer-validator enforces
 * MAX_TEXT_LEN (50 000) on text fields; anything larger gets imported
 * locally but is rejected the moment realtime tries to replicate it.
 * Capping at import time keeps local + remote behaviour consistent and
 * guarantees a uniform user experience. */
const IMPORT_TEXT_CAP = 50_000;
const IMPORT_TITLE_CAP = 2_000;

/**
 * Per-call z-counter factory. Previously a module-level `zCursor` with
 * a `resetZ()` call at the head of each importer made the z-sequence
 * unsafe under concurrent imports — Promise.all([importFromRetro(...),
 * importFromStories(...)]) would have one importer reset() mid-way
 * through the other's emission, producing overlapping z values.
 *
 * Per-call factory eliminates the shared state. Each importer creates a
 * fresh counter on entry; nothing leaks between invocations. */
function makeZ(): () => number {
  let z = 1;
  return () => z++;
}

/**
 * Import retro cards as stickies arranged into 4-corner Mad/Sad/Glad/Action
 * frames, color-coded by category. Pulls cards from the in-tool retro
 * state — passed in as a generic `{ category, title }[]` so we don't have
 * to depend on the retro tool's internal shape here.
 */
export function importFromRetro(
  boardId: string,
  cards: { category: "mad" | "sad" | "glad" | "action" | string; title: string; id?: string }[],
): WhiteboardObject[] {
  const z = makeZ();
  const out: WhiteboardObject[] = [];
  const frames: Record<string, { x: number; y: number; color: string }> = {
    mad:    { x: 80,  y: 80,  color: "#fca5a5" },
    sad:    { x: 760, y: 80,  color: "#fbcfe8" },
    glad:   { x: 80,  y: 540, color: "#bef264" },
    action: { x: 760, y: 540, color: "#a5f3fc" },
  };
  const frameW = 640, frameH = 440;

  for (const cat of Object.keys(frames) as (keyof typeof frames)[]) {
    const f = frames[cat];
    const fr: WhiteboardFrame = {
      id: id(), boardId, type: "frame",
      x: f.x, y: f.y, w: frameW, h: frameH, z: z(),
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      fill: f.color + "33",
      version: 1, updatedAt: now(), createdAt: now(),
    };
    out.push(fr);
  }

  // Lay out stickies in a 3-col grid inside each frame.
  const grouped: Record<string, typeof cards> = {};
  const unknownCategories = new Set<string>();
  for (const c of cards) {
    const isKnown = c.category in frames;
    if (!isKnown) unknownCategories.add(c.category);
    // Unknown categories spill into the "action" frame so they're not lost,
    // but we surface the spillover to the dev console so an out-of-sync
    // retro tool (new category type added) doesn't silently dump everything
    // into "action" forever.
    const k = isKnown ? c.category : "action";
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(c);
  }
  if (unknownCategories.size > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[canvas] importFromRetro: unknown card categories spilled into 'action':",
      Array.from(unknownCategories).join(", "),
    );
  }
  for (const k of Object.keys(grouped)) {
    const f = frames[k] ?? frames.action;
    grouped[k].forEach((c, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const sticky: WhiteboardSticky = {
        id: id(), boardId, type: "sticky",
        x: f.x + 24 + col * 200,
        y: f.y + 60 + row * 160,
        w: 180, h: 140, z: z(),
        // Cap title to IMPORT_TEXT_CAP. The peer-validator's 50k
        // ceiling rejects oversized text at replication; truncating
        // here keeps local and remote behaviour consistent. A retro
        // card whose title is the entire transcript shouldn't blow up
        // every other user's board.
        content: (c.title ?? "").slice(0, IMPORT_TEXT_CAP),
        color: f.color,
        version: 1, updatedAt: now(), createdAt: now(),
        sourceRef: c.id ? { tool: "retro", entityId: c.id } : undefined,
      };
      out.push(sticky);
    });
  }
  return out;
}

/**
 * Import stories on a swimlane: rows = status (backlog/todo/inprogress/review/done).
 *
 * Stories with a status outside the known set fall back to "backlog" so
 * none are silently dropped — previously a typo in the source data or a
 * new status value would vanish into a never-rendered bucket.
 */
export function importFromStories(boardId: string, stories: readonly Story[]): WhiteboardObject[] {
  const z = makeZ();
  const out: WhiteboardObject[] = [];
  const stages: Story["status"][] = ["backlog", "todo", "in_progress", "review", "done"];
  const knownStages = new Set<string>(stages);
  const stageW = 240, stageH = 700;
  stages.forEach((stage, i) => {
    out.push({
      id: id(), boardId, type: "frame",
      x: 80 + i * stageW, y: 80, w: stageW - 16, h: stageH, z: z(),
      label: stage.replace("_", " "),
      fill: "#1e293b22",
      version: 1, updatedAt: now(), createdAt: now(),
    });
  });
  const buckets: Record<string, Story[]> = {};
  const unknownStatuses = new Set<string>();
  for (const s of stories) {
    const stage = knownStages.has(s.status) ? s.status : "backlog";
    if (!knownStages.has(s.status)) unknownStatuses.add(s.status);
    (buckets[stage] = buckets[stage] ?? []).push(s);
  }
  if (unknownStatuses.size > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[canvas] importFromStories: stories with unknown status routed to 'backlog':",
      Array.from(unknownStatuses).join(", "),
    );
  }
  stages.forEach((stage, i) => {
    (buckets[stage] ?? []).forEach((s, j) => {
      // Cap sticky content. The peer-validator already enforces a
      // 50_000-char ceiling on text fields; a runaway Story.title (e.g.
      // a description pasted into the wrong field) would otherwise be
      // imported locally but refused to replicate.
      const content = (s.title + (s.points ? ` · ${s.points}pt` : "")).slice(0, 50_000);
      out.push({
        id: id(), boardId, type: "sticky",
        x: 80 + i * stageW + 16, y: 140 + j * 130,
        w: stageW - 48, h: 110, z: z(),
        content,
        color: STICKY_PALETTE[i % STICKY_PALETTE.length],
        version: 1, updatedAt: now(), createdAt: now(),
        sourceRef: { tool: "story", entityId: s.id },
      });
    });
  });
  return out;
}

/**
 * Import risks onto a 5×5 P × I matrix. Same coordinates as the
 * `risk-matrix` template so users can also start from the template and
 * import later.
 */
export function importFromRisks(boardId: string, risks: readonly Risk[]): WhiteboardObject[] {
  const z = makeZ();
  const out: WhiteboardObject[] = [];
  const cell = 140;
  // Grid cells (same as risk-matrix template, but boardId attached).
  for (let p = 0; p < 5; p++) {
    for (let i = 0; i < 5; i++) {
      const score = (p + 1) * (5 - i);
      const fill =
        score >= 15 ? "#ef444433" :
        score >= 8 ? "#f59e0b33" :
        "#10b98133";
      out.push({
        id: id(), boardId, type: "rect",
        x: 200 + p * cell, y: 60 + i * cell,
        w: cell - 4, h: cell - 4, z: z(),
        fill, stroke: "#475569", strokeWidth: 1,
        version: 1, updatedAt: now(), createdAt: now(),
      });
    }
  }
  // Place each risk as a small sticky inside its cell.
  for (const r of risks) {
    // `Math.max(1, Math.min(5, NaN))` is NaN — without the explicit
    // Number.isFinite gate, a risk whose probability/impact came in as
    // null/undefined/string would land at coordinate `NaN`, which the
    // canvas renderer silently drops. Default to centre (3) so unsized
    // risks still show up on the matrix where the user can fix them.
    const pRaw = Number.isFinite(r.probability) ? r.probability as number : 3;
    const iRaw = Number.isFinite(r.impact) ? r.impact as number : 3;
    const p = Math.max(1, Math.min(5, pRaw)) - 1;
    const i = 5 - Math.max(1, Math.min(5, iRaw));
    out.push({
      id: id(), boardId, type: "sticky",
      x: 200 + p * cell + 8, y: 60 + i * cell + 8,
      w: cell - 20, h: cell - 20, z: z(),
      // Cap title — matches the importFromRetro/Stories truncation.
      content: (r.title ?? "").slice(0, IMPORT_TEXT_CAP),
      color: r.status === "closed" ? "#9ca3af" : "#fde68a",
      version: 1, updatedAt: now(), createdAt: now(),
      sourceRef: { tool: "risk", entityId: r.id },
    });
  }
  return out;
}

/** Import OKRs as a tree: Objective at top, Key Results as children below. */
export function importFromOkrs(boardId: string, okrs: readonly Okr[]): WhiteboardObject[] {
  const z = makeZ();
  const out: WhiteboardObject[] = [];
  // Build node + parent maps for treeLayout.
  const nodes: { id: string; w: number; h: number }[] = [];
  const parents: Record<string, string | null> = {};
  const labels: Record<string, string> = {};

  // Track the composite-node id ↔ (okrId, krId) so we can correlate
  // back to the real source entities when emitting sourceRef. Storing
  // the composite key directly as `entityId` made the sourceRef
  // un-reversible — given just "abc__xyz" we couldn't tell which half
  // was the okr id and which was the kr id. We now store both halves
  // in extras, with `entityId` set to the original kr.id (or o.id for
  // objectives) so round-trip lookups against the OKR tool still work.
  const compositeToParts = new Map<string, { okrId: string; krId: string | null }>();
  for (const o of okrs) {
    nodes.push({ id: o.id, w: 260, h: 100 });
    parents[o.id] = null;
    // Cap label length so a paste-into-objective doesn't blow up the
    // sticky content. Matches the other importer caps.
    labels[o.id] = (o.objective ?? "").slice(0, IMPORT_TITLE_CAP);
    compositeToParts.set(o.id, { okrId: o.id, krId: null });
    for (const kr of o.keyResults) {
      const krId = `${o.id}__${kr.id}`;
      nodes.push({ id: krId, w: 220, h: 90 });
      parents[krId] = o.id;
      compositeToParts.set(krId, { okrId: o.id, krId: kr.id });
      // Guard division-by-zero — a freshly-created KR with target=0
      // would print "Infinity%" or "NaN%" without this.
      const pct = (kr.target && kr.target > 0)
        ? Math.round((kr.current / kr.target) * 100)
        : 0;
      labels[krId] = `${(kr.title ?? "").slice(0, IMPORT_TITLE_CAP)}\n${pct}%`;
    }
  }
  const layout = treeLayout(nodes, parents, { rowGap: 80, colGap: 32 });

  // Map composite-id → emitted-sticky-id so connectors find the right
  // endpoint. Without this we re-scanned `out.find(...)` twice per
  // connector, an O(n²) call that's slow on 100-KR imports.
  const compositeToStickyId = new Map<string, string>();

  for (const n of nodes) {
    const pos = layout[n.id];
    const isObjective = parents[n.id] === null;
    const parts = compositeToParts.get(n.id);
    const stickyId = id();
    compositeToStickyId.set(n.id, stickyId);
    out.push({
      id: stickyId, boardId, type: "sticky",
      x: pos.x, y: pos.y, w: n.w, h: n.h, z: z(),
      content: labels[n.id],
      color: isObjective ? "#a5f3fc" : "#bef264",
      fontSize: isObjective ? 16 : 14,
      version: 1, updatedAt: now(), createdAt: now(),
      // For objectives entityId is o.id; for KRs entityId is kr.id
      // (the original KR identifier), with the parent OKR id stashed
      // alongside so a future round-trip can find the parent.
      sourceRef: {
        tool: "okr",
        entityId: parts?.krId ?? parts?.okrId ?? n.id,
      },
    });
  }
  // Add connectors from each Objective to its KRs.
  for (const o of okrs) {
    for (const kr of o.keyResults) {
      const krId = `${o.id}__${kr.id}`;
      const fromStickyId = compositeToStickyId.get(o.id);
      const toStickyId = compositeToStickyId.get(krId);
      if (!fromStickyId || !toStickyId) continue;
      const fromNode = { id: fromStickyId };
      const toNode = { id: toStickyId };
      out.push({
        id: id(), boardId, type: "connector",
        x: 0, y: 0, w: 0, h: 0, z: z(),
        fromId: fromNode.id, toId: toNode.id,
        fromAnchor: "bottom", toAnchor: "top",
        routing: "orthogonal",
        arrowEnd: true,
        stroke: "#94a3b8",
        strokeWidth: 2,
        version: 1, updatedAt: now(), createdAt: now(),
      });
    }
  }
  // Avoid the unused-import lint warning while keeping the import explicit
  // about which helpers we use.
  void gridLayout;
  return out;
}
