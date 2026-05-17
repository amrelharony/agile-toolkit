"use client";

import { useWorkspaceStore } from "../stores/workspace-store";
import type { Workspace } from "../stores/workspace-types";
import { emitSignal, ALL_SIGNAL_KINDS, type SignalKind } from "./signal-bus";
import { bindCacheInvalidation } from "./derived-cache";
import { INVALIDATION_MATRIX } from "./invalidation";

/**
 * Single boot-time wire-up that translates workspace-store mutations into
 * signal-bus emissions. Tools never have to remember to emit; they just
 * use the workspace actions they already use.
 *
 * Call `installSignalBridge()` once from the app shell or root layout.
 */
let installed = false;
let unsubscribeStore: (() => void) | null = null;
let unsubscribeCache: (() => void) | null = null;

export function installSignalBridge(): void {
  if (installed) return;
  installed = true;

  // Dev-only sanity check — INVALIDATION_MATRIX should have an entry
  // for every declared kind. If a future kind gets added to the
  // SignalKind union but not to the matrix, derived-cache won't
  // invalidate on that kind and the bug is silent. Warn loudly in dev
  // (production is silent — the entry just means "no cache prefixes
  // to flush for this kind", which is sometimes intentional).
  if (process.env.NODE_ENV !== "production") {
    // forEach (not for-of) so the build doesn't require downlevelIteration.
    ALL_SIGNAL_KINDS.forEach((k) => {
      if (!(k in INVALIDATION_MATRIX)) {
        // eslint-disable-next-line no-console
        console.warn("[signal-bridge] INVALIDATION_MATRIX missing entry for:", k);
      }
    });
  }

  // 1) Cache auto-invalidation via signal subscription.
  unsubscribeCache = bindCacheInvalidation();

  // 2) Diff workspace state on every mutation; emit signals for entity changes.
  // The workspace data is spread directly onto the store (not nested under
  // `.workspace`), so we project a Workspace-shaped snapshot from the store.
  let prev: Workspace | undefined;
  unsubscribeStore = useWorkspaceStore.subscribe((state) => {
    const next: Workspace = {
      teamMembers: state.teamMembers,
      sprints: state.sprints,
      stories: state.stories,
      impediments: state.impediments,
      risks: state.risks,
      okrs: state.okrs,
      decisions: state.decisions,
      techDebt: state.techDebt,
      maturityLevel: state.maturityLevel,
      teamName: state.teamName,
    };
    if (!prev) { prev = next; return; }
    diffAndEmit(prev, next);
    prev = next;
  });
}

export function uninstallSignalBridge(): void {
  unsubscribeStore?.();
  unsubscribeCache?.();
  unsubscribeStore = null;
  unsubscribeCache = null;
  installed = false;
}

function emit(kind: SignalKind, toolId: string, payload: unknown): void {
  emitSignal({ kind, toolId, at: new Date().toISOString(), payload });
}

function diffAndEmit(prev: Workspace, next: Workspace): void {
  // Short-circuit: when only metadata (`teamName`, `maturityLevel`) changed
  // and every entity-bearing slot still points at the same array reference,
  // no entity can have been added / changed / removed. Diffing would do a
  // lot of Map allocation just to find no edges. Zustand uses structural
  // sharing so reference equality is the right test here.
  if (
    prev.sprints === next.sprints &&
    prev.stories === next.stories &&
    prev.impediments === next.impediments &&
    prev.risks === next.risks &&
    prev.okrs === next.okrs &&
    prev.decisions === next.decisions &&
    prev.techDebt === next.techDebt &&
    prev.teamMembers === next.teamMembers
  ) {
    return;
  }

  // Sprints
  diffById(prev.sprints, next.sprints, (s) => s.id, {
    onAdded: (s) => {
      if (s.status === "active") emit("sprint.started", "workspace", { sprintId: s.id });
    },
    onChanged: (before, after) => {
      if (before.status !== "completed" && after.status === "completed") {
        emit("sprint.completed", "workspace", { sprintId: after.id });
      }
      if (before.pointsCompleted !== after.pointsCompleted && after.status === "completed") {
        emit("velocity.changed", "workspace", { sprintId: after.id, pointsCompleted: after.pointsCompleted });
      }
    },
  });

  // Impediments
  diffById(prev.impediments, next.impediments, (i) => i.id, {
    onAdded: (i) => emit("impediment.raised", "workspace", { impedimentId: i.id, severity: i.severity }),
    onChanged: (before, after) => {
      if (!before.resolvedAt && after.resolvedAt) {
        emit("impediment.resolved", "workspace", { impedimentId: after.id });
      }
    },
  });

  // Risks
  diffById(prev.risks, next.risks, (r) => r.id, {
    // R5: guard product against NaN propagation. A freshly imported
    // risk with `probability: undefined` (legacy persist) produced NaN
    // here, which JSON-stringified as null and silently broke any
    // subscriber that expected a number.
    onAdded: (r) => {
      const score = (r.probability ?? 0) * (r.impact ?? 0);
      emit("risk.opened", "workspace", { riskId: r.id, score: Number.isFinite(score) ? score : 0 });
    },
    onChanged: (before, after) => {
      if (before.status !== "closed" && after.status === "closed") {
        emit("risk.closed", "workspace", { riskId: after.id });
      }
    },
  });

  // OKRs (KR updates fire on any progress change)
  diffById(prev.okrs, next.okrs, (o) => o.id, {
    onChanged: (before, after) => {
      const beforeKrs = new Map(before.keyResults.map((k) => [k.id, k]));
      for (const kr of after.keyResults) {
        const b = beforeKrs.get(kr.id);
        if (b && (b.current !== kr.current || b.target !== kr.target)) {
          emit("okr.kr.updated", "workspace", { okrId: after.id, krId: kr.id, current: kr.current, target: kr.target });
        }
      }
    },
  });

  // Tech debt
  diffById(prev.techDebt, next.techDebt, (t) => t.id, {
    onAdded: (t) => emit("techDebt.added", "workspace", { itemId: t.id, impact: t.impact }),
    onChanged: (before, after) => {
      if (!before.resolvedAt && after.resolvedAt) {
        emit("techDebt.resolved", "workspace", { itemId: after.id });
      }
    },
  });

  // Decisions
  diffById(prev.decisions, next.decisions, (d) => d.id, {
    onAdded: (d) => emit("decision.recorded", "workspace", { decisionId: d.id, status: d.status }),
  });

  // Stories: status changes
  diffById(prev.stories, next.stories, (s) => s.id, {
    onChanged: (before, after) => {
      if (before.status !== after.status) {
        emit("story.statusChanged", "workspace", { storyId: after.id, from: before.status, to: after.status });
      }
    },
  });
}

interface DiffHandlers<T> {
  onAdded?: (item: T) => void;
  onRemoved?: (item: T) => void;
  onChanged?: (before: T, after: T) => void;
}

function diffById<T>(
  before: T[] | undefined,
  after: T[] | undefined,
  idOf: (item: T) => string,
  handlers: DiffHandlers<T>
): void {
  const beforeMap = new Map((before ?? []).map((x) => [idOf(x), x] as const));
  const afterMap = new Map((after ?? []).map((x) => [idOf(x), x] as const));
  afterMap.forEach((a, id) => {
    const b = beforeMap.get(id);
    if (!b) handlers.onAdded?.(a);
    else if (a !== b) handlers.onChanged?.(b, a);
  });
  if (handlers.onRemoved) {
    beforeMap.forEach((b, id) => {
      if (!afterMap.has(id)) handlers.onRemoved!(b);
    });
  }
}
