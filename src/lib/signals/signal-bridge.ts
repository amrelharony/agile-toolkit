"use client";

import { useWorkspaceStore } from "../stores/workspace-store";
import type { Workspace } from "../stores/workspace-types";
import { emitSignal, ALL_SIGNAL_KINDS, type SignalKind } from "./signal-bus";
import { bindCacheInvalidation } from "./derived-cache";
import { INVALIDATION_MATRIX } from "./invalidation";
import { isExampleId } from "../utils/example-id";

/**
 * Squad-profile id of the local viewer. Set by guest pages via
 * `setLocalViewerProfileId(profile.id)` so the bridge can decide whether
 * a kudos add is BOTH a `kudos.sent` (any add) AND a `kudos.received`
 * (the new row is addressed to the local viewer). Owner-side viewers
 * receive kudos via `toProfileId === null` (workspace-wide wall) — they
 * see every kudos as both sent and received because the wall is theirs.
 * Reset to `null` on sign-out.
 */
let localViewerProfileId: string | null = null;
export function setLocalViewerProfileId(id: string | null): void {
  localViewerProfileId = id;
}

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
  //
  // R11-fix: include Phase 19+ entities (llmEvals, prompts, hallucinations,
  // prioritizations, DACI/RAPID/weighted decisions). Previously the
  // projection covered only Phase ≤18 fields, so every Phase 19+ kind
  // declared in INVALIDATION_MATRIX never fired its signal — derived
  // caches keyed on `llmEval:`, `prompt:`, `prioritization:`, etc.
  // stayed stale until TTL.
  // BUG-SB1: capture the baseline EAGERLY from the current store state.
  // Zustand only invokes subscribers on mutations, so the previous
  // lazily-captured baseline ("first callback seeds prev and returns")
  // silently swallowed the FIRST real mutation of every session — no
  // signal fired for it, derived caches stayed stale, gamification/kudos
  // consumers missed the event.
  let prev: Workspace | undefined = projectWorkspace(useWorkspaceStore.getState());
  unsubscribeStore = useWorkspaceStore.subscribe((state) => {
    const next = projectWorkspace(state);
    if (!prev) {
      prev = next;
      return;
    }
    diffAndEmit(prev, next);
    prev = next;
  });
}

type WorkspaceStoreState = ReturnType<typeof useWorkspaceStore.getState>;

function projectWorkspace(state: WorkspaceStoreState): Workspace {
  return {
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
    llmEvals: state.llmEvals,
    prompts: state.prompts,
    hallucinations: state.hallucinations,
    prioritizations: state.prioritizations,
    daciDecisions: state.daciDecisions,
    rapidDecisions: state.rapidDecisions,
    weightedOptions: state.weightedOptions,
    // R11-batch-14: round out Phase 19+ coverage. The remaining
    // declared signal kinds (model.upgraded, redTeam.*, agentWorkflow.*,
    // hitl.*, rlhf.*, vector.*, modelCard.published, six-hats,
    // OODA, cynefin) had INVALIDATION_MATRIX entries but no emit
    // sites. After this projection extension the entire Phase 19+
    // surface flows through the bridge.
    models: state.models,
    redTeamFindings: state.redTeamFindings,
    agentWorkflows: state.agentWorkflows,
    hitlReviews: state.hitlReviews,
    rlhfPairs: state.rlhfPairs,
    vectorCollections: state.vectorCollections,
    modelCards: state.modelCards,
    sixHatsThoughts: state.sixHatsThoughts,
    oodaCycles: state.oodaCycles,
    cynefinItems: state.cynefinItems,
    staceyItems: state.staceyItems,
    polarities: state.polarities,
    // Phase 0 kudos redesign — diff kudos to emit kudos.sent on adds
    // and kudos.received when the local viewer's profile id matches
    // the new row's toProfileId.
    kudos: state.kudos,
  };
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
    prev.teamMembers === next.teamMembers &&
    // R11-fix: extend short-circuit to Phase 19+ entities.
    prev.llmEvals === next.llmEvals &&
    prev.prompts === next.prompts &&
    prev.hallucinations === next.hallucinations &&
    prev.prioritizations === next.prioritizations &&
    prev.daciDecisions === next.daciDecisions &&
    prev.rapidDecisions === next.rapidDecisions &&
    prev.weightedOptions === next.weightedOptions &&
    // R11-batch-14: extend short-circuit to remaining Phase 19+ slots.
    prev.models === next.models &&
    prev.redTeamFindings === next.redTeamFindings &&
    prev.agentWorkflows === next.agentWorkflows &&
    prev.hitlReviews === next.hitlReviews &&
    prev.rlhfPairs === next.rlhfPairs &&
    prev.vectorCollections === next.vectorCollections &&
    prev.modelCards === next.modelCards &&
    prev.sixHatsThoughts === next.sixHatsThoughts &&
    prev.oodaCycles === next.oodaCycles &&
    prev.cynefinItems === next.cynefinItems &&
    prev.staceyItems === next.staceyItems &&
    prev.polarities === next.polarities &&
    prev.kudos === next.kudos
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
        emit("velocity.changed", "workspace", {
          sprintId: after.id,
          pointsCompleted: after.pointsCompleted,
        });
      }
    },
  });

  // Impediments
  diffById(prev.impediments, next.impediments, (i) => i.id, {
    onAdded: (i) => {
      // R10: if an impediment is imported already-resolved (rare via UI
      // but possible via importJSON), the bridge previously fired only
      // `raised` and never `resolved` — the resolved-state stayed
      // invisible to consumers. Fire both so dashboards converge.
      emit("impediment.raised", "workspace", { impedimentId: i.id, severity: i.severity });
      if (i.resolvedAt) {
        emit("impediment.resolved", "workspace", { impedimentId: i.id });
      }
    },
    onChanged: (before, after) => {
      if (!before.resolvedAt && after.resolvedAt) {
        emit("impediment.resolved", "workspace", { impedimentId: after.id });
      }
    },
    // R11-fix: removals fire `resolved` so dashboards / insights cache
    // invalidate. Previously delete-events were silent — caches stayed
    // populated until TTL.
    onRemoved: (i) => {
      if (!i.resolvedAt) {
        emit("impediment.resolved", "workspace", { impedimentId: i.id });
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
      // R10: importing a CLOSED risk previously emitted a spurious
      // `risk.opened` — dashboards counted it as fresh. Gate on
      // open-state so closed/accepted imports stay quiet.
      const score = (r.probability ?? 0) * (r.impact ?? 0);
      if (r.status === "open" || r.status === "mitigating") {
        emit("risk.opened", "workspace", {
          riskId: r.id,
          score: Number.isFinite(score) ? score : 0,
        });
      } else if (r.status === "closed") {
        emit("risk.closed", "workspace", { riskId: r.id });
      }
    },
    onChanged: (before, after) => {
      if (before.status !== "closed" && after.status === "closed") {
        emit("risk.closed", "workspace", { riskId: after.id });
      }
    },
    // R11-fix: removals fire `closed`. Survival-curve / open-risk
    // dashboards otherwise count deleted risks as still-open.
    onRemoved: (r) => {
      if (r.status !== "closed") {
        emit("risk.closed", "workspace", { riskId: r.id });
      }
    },
  });

  // OKRs (KR updates fire on any progress change)
  diffById(prev.okrs, next.okrs, (o) => o.id, {
    onChanged: (before, after) => {
      const beforeKrs = new Map(before.keyResults.map((k) => [k.id, k]));
      for (const kr of after.keyResults) {
        const b = beforeKrs.get(kr.id);
        if (!b) continue;
        // R10: emit on TITLE change too — was previously gated on
        // current/target only, so renaming a KR left the canvas
        // sticky/card showing the old title.
        if (b.current !== kr.current || b.target !== kr.target || b.title !== kr.title) {
          emit("okr.kr.updated", "workspace", {
            okrId: after.id,
            krId: kr.id,
            current: kr.current,
            target: kr.target,
          });
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
    // R11-fix: removals fire `resolved` so debt-burn-down dashboards
    // don't keep deleted items in the open-debt count.
    onRemoved: (t) => {
      if (!t.resolvedAt) {
        emit("techDebt.resolved", "workspace", { itemId: t.id });
      }
    },
  });

  // Decisions
  diffById(prev.decisions, next.decisions, (d) => d.id, {
    onAdded: (d) => emit("decision.recorded", "workspace", { decisionId: d.id, status: d.status }),
    // R10: emit on status flip too. A proposed → accepted transition is
    // the actual "decision made" event most consumers care about;
    // without this branch dashboards/cache invalidators only saw the
    // initial draft creation and stayed stale through approval.
    onChanged: (before, after) => {
      if (before.status !== after.status) {
        emit("decision.recorded", "workspace", { decisionId: after.id, status: after.status });
      }
    },
  });

  // Stories: status changes
  diffById(prev.stories, next.stories, (s) => s.id, {
    onChanged: (before, after) => {
      const statusChanged = before.status !== after.status;
      const titleChanged = before.title !== after.title;
      const pointsChanged = before.points !== after.points;
      // R11-fix: avoid double-emit when both status and title/points
      // change in the same diff. Previously this emitted TWO
      // `story.statusChanged` events (once for status, once with
      // `from === to` for title/points), causing canvas card-sync
      // and any consumer counting "status changes" to double-process.
      // Now: single emit with combined flags.
      if (statusChanged || titleChanged || pointsChanged) {
        emit("story.statusChanged", "workspace", {
          storyId: after.id,
          from: before.status,
          to: after.status,
          titleChanged,
          pointsChanged,
        });
      }
    },
  });

  // ──────────────────────────────────────────────────────────────────
  // Phase 19+ entities (R11). Minimal-emit handlers wire the most-
  // user-visible signals so derived caches invalidate on the right
  // mutations. Subtle status-transition emits left to follow-on work.
  // ──────────────────────────────────────────────────────────────────

  // LLM evals — fire `llmEval.recorded` on every add (downstream
  // anomaly detector decides if it's a regression).
  diffById(prev.llmEvals, next.llmEvals, (e) => e.id, {
    onAdded: (e) =>
      emit("llmEval.recorded", "workspace", {
        evalId: e.id,
        model: e.model,
        dataset: e.dataset,
        score: e.score,
      }),
  });

  // Prompt versions — fire `prompt.versionPublished` on status flip to
  // production (most-watched lifecycle event).
  diffById(prev.prompts, next.prompts, (p) => p.id, {
    onAdded: (p) => {
      if (p.status === "production") {
        emit("prompt.versionPublished", "workspace", { promptId: p.id, version: p.version });
      }
    },
    onChanged: (before, after) => {
      if (before.status !== "production" && after.status === "production") {
        emit("prompt.versionPublished", "workspace", {
          promptId: after.id,
          version: after.version,
        });
      }
    },
  });

  // Hallucinations — fire `logged` on add and `resolved` on resolution.
  diffById(prev.hallucinations, next.hallucinations, (h) => h.id, {
    onAdded: (h) => {
      emit("hallucination.logged", "workspace", { id: h.id, severity: h.severity });
      if (h.resolvedAt) {
        emit("hallucination.resolved", "workspace", { id: h.id });
      }
    },
    onChanged: (before, after) => {
      if (!before.resolvedAt && after.resolvedAt) {
        emit("hallucination.resolved", "workspace", { id: after.id });
      }
    },
    onRemoved: (h) => {
      if (!h.resolvedAt) emit("hallucination.resolved", "workspace", { id: h.id });
    },
  });

  // Prioritizations — fire scored on every add/change with a non-zero
  // score (the user's "I evaluated this item" event).
  diffById(prev.prioritizations, next.prioritizations, (p) => p.id, {
    onAdded: (p) => {
      if (Number.isFinite(p.score) && p.score !== 0) {
        emit("prioritization.scored", "workspace", {
          itemId: p.id,
          framework: p.framework,
          score: p.score,
        });
      }
    },
    onChanged: (before, after) => {
      if (before.score !== after.score && Number.isFinite(after.score)) {
        emit("prioritization.scored", "workspace", {
          itemId: after.id,
          framework: after.framework,
          score: after.score,
        });
      }
    },
  });

  // DACI decisions
  diffById(prev.daciDecisions, next.daciDecisions, (d) => d.id, {
    onAdded: (d) => emit("decision.daciCreated", "workspace", { id: d.id, title: d.title }),
  });

  // RAPID decisions
  diffById(prev.rapidDecisions, next.rapidDecisions, (d) => d.id, {
    onAdded: (d) => emit("decision.rapidCreated", "workspace", { id: d.id, title: d.title }),
  });

  // Weighted decisions — fire on score change (most-watched lifecycle
  // event in this framework).
  diffById(prev.weightedOptions, next.weightedOptions, (o) => o.id, {
    onAdded: (o) => emit("decision.weightedScored", "workspace", { id: o.id }),
    onChanged: (before, after) => {
      // `scores` is a Record — detect any mutation cheaply via JSON.
      if (JSON.stringify(before.scores ?? {}) !== JSON.stringify(after.scores ?? {})) {
        emit("decision.weightedScored", "workspace", { id: after.id });
      }
    },
  });

  // R11-batch-14: remaining Phase 19+ entities (declared SignalKinds
  // but no emit-sites until now → INVALIDATION_MATRIX entries were
  // silently dead).

  // Model registry — emit `model.upgraded` when a model transitions
  // INTO production status (the cache-busting event consumers care
  // about; status flips from evaluation/experimental → production).
  diffById(prev.models, next.models, (m) => m.id, {
    onAdded: (m) => {
      if (m.status === "production") {
        emit("model.upgraded", "workspace", { id: m.id, name: m.name, status: m.status });
      }
    },
    onChanged: (before, after) => {
      if (before.status !== "production" && after.status === "production") {
        emit("model.upgraded", "workspace", {
          id: after.id,
          name: after.name,
          status: after.status,
        });
      }
    },
  });

  // Red-team findings — open on add (unless already resolved at
  // import time), close on resolution or removal.
  diffById(prev.redTeamFindings, next.redTeamFindings, (f) => f.id, {
    onAdded: (f) => {
      if (!f.resolvedAt) {
        emit("redTeam.findingOpened", "workspace", { id: f.id, severity: f.severity });
      } else {
        emit("redTeam.findingClosed", "workspace", { id: f.id });
      }
    },
    onChanged: (before, after) => {
      if (!before.resolvedAt && after.resolvedAt) {
        emit("redTeam.findingClosed", "workspace", { id: after.id });
      }
    },
    onRemoved: (f) => {
      if (!f.resolvedAt) emit("redTeam.findingClosed", "workspace", { id: f.id });
    },
  });

  // Agent workflows — created on add.
  diffById(prev.agentWorkflows, next.agentWorkflows, (w) => w.id, {
    onAdded: (w) => emit("agentWorkflow.created", "workspace", { id: w.id, name: w.name }),
  });

  // HITL reviews — fire `hitl.reviewLogged` per review.
  diffById(prev.hitlReviews, next.hitlReviews, (r) => r.id, {
    onAdded: (r) => emit("hitl.reviewLogged", "workspace", { id: r.id, rating: r.rating }),
  });

  // RLHF pairs — fire `rlhf.pairLogged` per pair.
  diffById(prev.rlhfPairs, next.rlhfPairs, (p) => p.id, {
    onAdded: (p) => emit("rlhf.pairLogged", "workspace", { id: p.id, winner: p.winner }),
  });

  // Vector collections — fire `vector.collectionAdded` on add.
  diffById(prev.vectorCollections, next.vectorCollections, (v) => v.id, {
    onAdded: (v) => emit("vector.collectionAdded", "workspace", { id: v.id, name: v.name }),
  });

  // Model cards — fire `modelCard.published` on add (model cards are
  // by definition the published artifact; status transitions are not
  // modelled separately).
  diffById(prev.modelCards, next.modelCards, (c) => c.id, {
    onAdded: (c) => emit("modelCard.published", "workspace", { id: c.id, modelName: c.modelName }),
  });

  // Six-hats thoughts — fire per add.
  diffById(prev.sixHatsThoughts, next.sixHatsThoughts, (t) => t.id, {
    onAdded: (t) => emit("sixHats.thoughtLogged", "workspace", { id: t.id, hat: t.hat }),
  });

  // OODA cycles — fire on completion (transition to non-empty
  // completedAt).
  diffById(prev.oodaCycles, next.oodaCycles, (c) => c.id, {
    onChanged: (before, after) => {
      if (!before.completedAt && after.completedAt) {
        emit("ooda.cycleCompleted", "workspace", { id: after.id, topic: after.topic });
      }
    },
    onAdded: (c) => {
      if (c.completedAt) {
        emit("ooda.cycleCompleted", "workspace", { id: c.id, topic: c.topic });
      }
    },
  });

  // Cynefin classifications — fire per add (the "decision.cynefin
  // Classified" event consumers care about).
  diffById(prev.cynefinItems, next.cynefinItems, (i) => i.id, {
    onAdded: (i) => emit("decision.cynefinClassified", "workspace", { id: i.id, domain: i.domain }),
    onChanged: (before, after) => {
      if (before.domain !== after.domain) {
        emit("decision.cynefinClassified", "workspace", { id: after.id, domain: after.domain });
      }
    },
  });

  // Stacey matrix items — fire per add (or on region change).
  diffById(prev.staceyItems, next.staceyItems, (i) => i.id, {
    onAdded: (i) => emit("decision.staceyClassified", "workspace", { id: i.id, region: i.region }),
    onChanged: (before, after) => {
      if (before.region !== after.region) {
        emit("decision.staceyClassified", "workspace", { id: after.id, region: after.region });
      }
    },
  });

  // Polarities — fire per add.
  diffById(prev.polarities, next.polarities, (p) => p.id, {
    onAdded: (p) => emit("decision.polarityMapped", "workspace", { id: p.id, title: p.title }),
  });

  // Kudos — `kudos.sent` on every add (sender side AND every peer that
  // received the broadcast and ran it through upsertKudos), plus
  // `kudos.received` when the new row is addressed to the local viewer.
  // Owners view their own wall and see every kudos as workspace-wide,
  // so when `localViewerProfileId` is null we treat any add as a
  // received-event too — that's the owner-self-receive case for
  // gamification XP. Guests only count receives when the row names them.
  //
  // Example kudos (Kudos' "Load an example") stay quiet: no signal means
  // no cloud POST, no XP, no sound and no beacon for data nobody sent.
  diffById(prev.kudos, next.kudos, (k) => k.id, {
    onAdded: (k) => {
      if (isExampleId(k.id)) return;
      emit("kudos.sent", "kudos", {
        id: k.id,
        toProfileId: k.toProfileId,
        fromProfileId: k.fromProfileId,
        theme: typeof k.theme === "string" ? k.theme : k.theme.id,
      });
      // `kudos.received` must NOT fire for self-authored rows or the
      // owner double-counts every send as both sent and received,
      // unlocking `receiver-10` from their own outbox. Two gates:
      //   1. Guest mode (viewer id set) — `toProfileId` matches AND
      //      `fromProfileId` does NOT match the viewer.
      //   2. Owner mode (viewer id null) — the row is guest-authored
      //      (fromProfileId is non-null; owner-authored rows leave it
      //      null) and lands on the workspace-wide wall (no
      //      toProfileId picking a specific OTHER recipient).
      let addressedToMe = false;
      if (localViewerProfileId !== null) {
        addressedToMe =
          k.toProfileId === localViewerProfileId && k.fromProfileId !== localViewerProfileId;
      } else {
        addressedToMe = Boolean(k.fromProfileId) && !k.toProfileId;
      }
      if (addressedToMe) {
        emit("kudos.received", "kudos", { id: k.id, fromProfileId: k.fromProfileId });
      }
    },
    onChanged: (before, after) => {
      if (isExampleId(after.id)) return;
      const beforeReactions = before.reactions?.length ?? 0;
      const afterReactions = after.reactions?.length ?? 0;
      if (afterReactions > beforeReactions) {
        emit("kudos.reaction.added", "kudos", { id: after.id, count: afterReactions });
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
