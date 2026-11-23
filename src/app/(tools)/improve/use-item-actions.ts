"use client";

/**
 * Every change the page makes to one improvement, in one place: each goes
 * through the model's changers (so the caps and rules are the CRUD's and the
 * verbs'), stamps updatedAt, refuses a write that would grow the record past
 * one synced row (saying so in place), logs its history name (never for an
 * example) and announces itself. Deletes, accepted AI suggestions, Reached
 * it and a coaching talk come with Undo.
 */

import { useState } from "react";
import { nanoid } from "nanoid";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { cheer } from "@/lib/celebrate/cheer";
import { findLink, withoutLink } from "@/lib/handoffs/links";
import { sendHandoff } from "@/lib/handoffs/send";
import { IMPROVE_ACTIONS } from "@/lib/history/event-actions";
import { latestCheckInDay } from "@/lib/okrs/progress";
import { cleanLine, cleanText } from "@/lib/root-cause/model";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  TOOL_TEXT_MAX,
  type HandoffLink,
  type Improvement,
  type ImprovementCondition,
  type ImprovementObstacle,
  type ImprovementReading,
  type ImprovementStatus,
  type ImprovementStep,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { undoable } from "@/lib/utils/undoable";
import {
  IMPROVE_TOOL,
  OBSTACLE_REFUSAL_TEXT,
  READING_REFUSAL_TEXT,
  STATUS_LABEL,
  STEP_REFUSAL_TEXT,
  TOO_BIG,
  fitsRow,
  isActive,
  readImprovement,
  touched,
  withCondition,
  withObstacle,
  withObstacleAt,
  withObstacleLinks,
  withObstaclePatch,
  withPastTargetAt,
  withReading,
  withReadingAt,
  withStatus,
  withStep,
  withStepAt,
  withStepLinks,
  withStepPatch,
  withTargetReached,
  withoutObstacle,
  withoutPastTarget,
  withoutReading,
  withoutStep,
  type ReadingInput,
  type StepInput,
} from "@/lib/improve/model";
import { withCoaching, type CoachAnswers, type CoachRefusal } from "@/lib/improve/coaching";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();

/** The stored improvement, read safely, or null when it is gone. */
export function freshImprovement(id: string): Improvement | null {
  const raw = (ws().improvements ?? []).find((i) => i.id === id);
  return raw ? readImprovement(raw) : null;
}

/** A name short enough for a toast or an announcement. */
export const short = (s: string, max = 40) => cleanLine(s, max);

export type Log = (action: string, payload?: Record<string, unknown>) => void;

/** The text fields edited in place. */
export type TextField = "background" | "analysis" | "check" | "followUp";

/** What the coaching talk's refusals say, by step. */
export const COACH_REFUSAL_TEXT: Record<CoachRefusal["reason"], string> = {
  ...READING_REFUSAL_TEXT,
  blank: "Say what you'll try.",
  needs_expect: "Say what you expect before you try.",
  list_full: "This Kata's list is full: remove an old row first.",
  past_date: "Pick today or a later day.",
};

/** Links added by a change (the send itself, not its Undo). */
const added = (before: readonly HandoffLink[] | undefined, after: readonly HandoffLink[]) =>
  after.filter(
    (l) => !(before ?? []).some((b) => b.route === l.route && b.targetId === l.targetId)
  );

export function useItemActions(itemId: string, log: Log) {
  const announce = useAnnounce();
  const [rowError, setRowError] = useState<string | null>(null);
  const example = isExampleId(itemId);
  const logIt: Log = (action, payload) => {
    if (!example) log(action, { itemId, ...payload });
  };

  /** Change the improvement through the store, stamped; the saved one, or null. */
  const write = (fn: (cur: Improvement, now: string) => Improvement | null): Improvement | null => {
    const cur = freshImprovement(itemId);
    if (!cur) return null;
    const next = fn(cur, nowIso());
    if (!next) return null;
    if (!fitsRow(next) && jsonBytes(next) > jsonBytes(cur)) {
      setRowError(TOO_BIG);
      announce(TOO_BIG);
      return null;
    }
    setRowError(null);
    ws().upsertImprovement(next);
    return next;
  };

  const setTitle = (text: string) => {
    const title = cleanLine(text, TOOL_TEXT_MAX.short);
    if (!title) return;
    if (write((cur, now) => touched(cur, { title }, now))) {
      logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "title" });
    }
  };

  const setText = (field: TextField, text: string) => {
    const clean = cleanText(text, TOOL_TEXT_MAX.text);
    const saved = write((cur, now) =>
      field === "background"
        ? touched(cur, { background: clean }, now)
        : touched(cur, { [field]: clean || undefined }, now)
    );
    if (saved) logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field });
  };

  const setPerson = (field: "owner" | "coach", name: string) => {
    const clean = cleanLine(name, TOOL_TEXT_MAX.short);
    if (write((cur, now) => touched(cur, { [field]: clean || undefined }, now))) {
      logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field });
    }
  };

  const setCondition = (which: "current" | "target", patch: Partial<ImprovementCondition>) => {
    if (write((cur, now) => withCondition(cur, which, patch, now))) {
      logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: which });
    }
  };

  const setStatus = (status: ImprovementStatus) => {
    const was = freshImprovement(itemId);
    if (!was || was.status === status) return;
    if (!write((cur, now) => withStatus(cur, status, now))) return;
    if (isActive(was) && !isActive({ status })) {
      logIt(IMPROVE_ACTIONS.ITEM_CLOSED, { status });
    } else {
      logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "status" });
    }
    announce(`Status: ${STATUS_LABEL[status]}.`);
  };

  /* ── Steps ── */

  /** Add a step; the refusal in words, or null when it was added. */
  const addStep = (input: StepInput, opts?: { fromAi?: boolean }): string | null => {
    const cur = freshImprovement(itemId);
    if (!cur) return null;
    const stepId = nanoid(8);
    const check = withStep(cur, input, stepId, nowIso());
    if (!check.ok) return STEP_REFUSAL_TEXT[check.reason];
    const noun = cur.method === "kata" ? "experiment" : "countermeasure";
    let refused: string | null = null;
    const apply = () => {
      const saved = write((c, now) => {
        const r = withStep(c, input, stepId, now);
        return r.ok ? r.item : null;
      });
      if (!saved) {
        refused = TOO_BIG;
        return;
      }
      logIt(IMPROVE_ACTIONS.STEP_ADDED, { stepId });
      announce(`Added the ${noun} “${short(input.text)}”.`);
    };
    if (opts?.fromAi) {
      undoable({
        label: `Added a${noun === "experiment" ? "n" : ""} ${noun}`,
        description: `“${short(input.text)}”`,
        kind: "success",
        apply,
        revert: () => write((c, now) => withoutStep(c, stepId, now)),
      });
    } else apply();
    return refused;
  };

  /** Change a step; the refusal in words, or null when it was saved. */
  const patchStep = (stepId: string, patch: Partial<StepInput>): string | null => {
    const cur = freshImprovement(itemId);
    const before = cur?.steps.find((s) => s.id === stepId);
    if (!cur || !before) return null;
    const check = withStepPatch(cur, stepId, patch, nowIso());
    if (!check.ok) return STEP_REFUSAL_TEXT[check.reason];
    const saved = write((c, now) => {
      const r = withStepPatch(c, stepId, patch, now);
      return r.ok ? r.item : null;
    });
    if (!saved) return TOO_BIG;
    if (patch.status === "done" && before.status !== "done") {
      logIt(IMPROVE_ACTIONS.STEP_DONE, { stepId });
      announce(`“${short(before.text)}” is done.`);
    } else {
      logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "steps" });
    }
    return null;
  };

  const removeStep = (step: ImprovementStep) => {
    const at = freshImprovement(itemId)?.steps.findIndex((s) => s.id === step.id) ?? -1;
    undoable({
      label: `Deleted “${short(step.text)}”`,
      apply: () => {
        if (write((c, now) => withoutStep(c, step.id, now))) {
          logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "steps" });
        }
      },
      revert: () => write((c, now) => withStepAt(c, step, at, now)),
    });
  };

  const stepLinks = (
    stepId: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    let before: readonly HandoffLink[] | undefined;
    let after: HandoffLink[] = [];
    const saved = write((c, now) => {
      before = c.steps.find((s) => s.id === stepId)?.sentTo;
      after = update(before);
      return withStepLinks(c, stepId, after, now);
    });
    if (!saved) return;
    for (const link of added(before, after)) {
      logIt(IMPROVE_ACTIONS.STEP_SENT, { stepId, route: link.route, targetId: link.targetId });
    }
  };

  /* ── Obstacles ── */

  const addObstacle = (text: string): string | null => {
    const cur = freshImprovement(itemId);
    if (!cur) return null;
    const obstacleId = nanoid(8);
    const check = withObstacle(cur, text, obstacleId, nowIso());
    if (!check.ok) return OBSTACLE_REFUSAL_TEXT[check.reason];
    const saved = write((c, now) => {
      const r = withObstacle(c, text, obstacleId, now);
      return r.ok ? r.item : null;
    });
    if (!saved) return TOO_BIG;
    logIt(IMPROVE_ACTIONS.OBSTACLE_ADDED, { obstacleId });
    announce(`Added the obstacle “${short(text)}”.`);
    return null;
  };

  const patchObstacle = (
    obstacle: ImprovementObstacle,
    patch: { text?: string; status?: ImprovementObstacle["status"] }
  ) => {
    if (!write((c, now) => withObstaclePatch(c, obstacle.id, patch, now))) return;
    if (patch.status === "cleared" && obstacle.status !== "cleared") {
      logIt(IMPROVE_ACTIONS.OBSTACLE_CLEARED, { obstacleId: obstacle.id });
      announce(`Cleared “${short(obstacle.text)}”.`);
      return;
    }
    logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "obstacles" });
    if (patch.status === "working") announce(`Working on “${short(obstacle.text)}” now.`);
  };

  const removeObstacle = (obstacle: ImprovementObstacle) => {
    const at = freshImprovement(itemId)?.obstacles.findIndex((o) => o.id === obstacle.id) ?? -1;
    undoable({
      label: `Deleted “${short(obstacle.text)}”`,
      apply: () => {
        if (write((c, now) => withoutObstacle(c, obstacle.id, now))) {
          logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "obstacles" });
        }
      },
      revert: () => write((c, now) => withObstacleAt(c, obstacle, at, now)),
    });
  };

  const obstacleLinks = (
    obstacleId: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    let before: readonly HandoffLink[] | undefined;
    let after: HandoffLink[] = [];
    const saved = write((c, now) => {
      before = c.obstacles.find((o) => o.id === obstacleId)?.sentTo;
      after = update(before);
      return withObstacleLinks(c, obstacleId, after, now);
    });
    if (!saved) return;
    for (const link of added(before, after)) {
      logIt(IMPROVE_ACTIONS.OBSTACLE_SENT, {
        obstacleId,
        route: link.route,
        targetId: link.targetId,
      });
    }
  };

  /* ── Readings and targets ── */

  /** The latest day a reading may be for: today, on the person's own clock. */
  const latestDay = () => latestCheckInDay(todayIso(), false);

  const addReading = (input: ReadingInput): string | null => {
    const cur = freshImprovement(itemId);
    if (!cur) return null;
    const readingId = nanoid(8);
    const check = withReading(cur, input, readingId, nowIso(), latestDay());
    if (!check.ok) return READING_REFUSAL_TEXT[check.reason];
    const saved = write((c, now) => {
      const r = withReading(c, input, readingId, now, latestDay());
      return r.ok ? r.item : null;
    });
    if (!saved) return TOO_BIG;
    logIt(IMPROVE_ACTIONS.READING_LOGGED, { day: input.date });
    announce(`Logged ${input.value} for ${input.date}.`);
    return null;
  };

  const removeReading = (reading: ImprovementReading) => {
    const at = freshImprovement(itemId)?.readings.findIndex((r) => r.id === reading.id) ?? -1;
    undoable({
      label: `Deleted the reading for ${reading.date}`,
      apply: () => {
        if (write((c, now) => withoutReading(c, reading.id, now))) {
          logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "readings" });
        }
      },
      revert: () => write((c, now) => withReadingAt(c, reading, at, now)),
    });
  };

  /** Keep where things stood and the targets, to put back on Undo. */
  const targetSnapshot = (c: Improvement) => ({
    current: c.current,
    target: c.target,
    pastTargets: c.pastTargets,
  });

  const reachTarget = () => {
    const before = freshImprovement(itemId);
    if (!before || !withTargetReached(before, nowIso())) return;
    const snapshot = targetSnapshot(before);
    undoable({
      label: "Target reached",
      description: "Set the next one: a few weeks away, never the whole challenge.",
      kind: "success",
      apply: () => {
        const saved = write((c, now) => withTargetReached(c, now));
        if (!saved) return;
        logIt(IMPROVE_ACTIONS.TARGET_REACHED, { reached: saved.pastTargets?.length ?? 0 });
        if (!example) cheer(IMPROVE_TOOL, "milestone");
        announce("Target reached. Where you are now starts the next one: set the next target.");
      },
      revert: () => write((c, now) => touched(c, snapshot, now)),
    });
  };

  const removePastTarget = (index: number) => {
    const before = freshImprovement(itemId);
    const target = before?.pastTargets?.[index];
    if (!target) return;
    undoable({
      label: `Deleted the past target “${short(target.text || "No words")}”`,
      apply: () => {
        if (write((c, now) => withoutPastTarget(c, index, now))) {
          logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "pastTargets" });
        }
      },
      revert: () => write((c, now) => withPastTargetAt(c, target, index, now)),
    });
  };

  /* ── Coaching ── */

  /** Save a coaching talk in one write with one Undo; the refusal, or null. */
  const saveCoaching = (answers: CoachAnswers): CoachRefusal | null => {
    const before = freshImprovement(itemId);
    if (!before) return null;
    const ids = { reading: nanoid(8), obstacle: nanoid(8), step: nanoid(8) };
    const today = todayIso();
    const check = withCoaching(before, answers, ids, nowIso(), { today, latestDay: latestDay() });
    if (!check.ok) return check.refusal;
    undoable({
      label: "Coaching talk saved",
      kind: "success",
      apply: () => {
        let outcome: { reading: boolean; experiment: boolean; reached: boolean } | null = null;
        const saved = write((c, now) => {
          const r = withCoaching(c, answers, ids, now, { today, latestDay: latestDay() });
          if (!r.ok) return null;
          outcome = r.outcome;
          return r.outcome.item;
        });
        const done = outcome as { reading: boolean; experiment: boolean; reached: boolean } | null;
        if (!saved || !done) return;
        logIt(IMPROVE_ACTIONS.COACHING_DONE, {
          next: saved.nextCoachingAt ?? null,
          reading: done.reading,
          experiment: done.experiment,
        });
        if (done.reached) {
          logIt(IMPROVE_ACTIONS.TARGET_REACHED, { reached: saved.pastTargets?.length ?? 0 });
          if (!example) cheer(IMPROVE_TOOL, "milestone");
        }
        announce(
          saved.nextCoachingAt
            ? `Coaching talk saved. The next one is on ${saved.nextCoachingAt}.`
            : "Coaching talk saved."
        );
      },
      revert: () => write((_c, now) => touched(before, {}, now)),
    });
    return null;
  };

  /* ── The Root Cause analysis ── */

  /** Link an analysis (or none); unlinking also forgets the analysis it opened. */
  const linkAnalysis = (analysisId: string | undefined) => {
    const saved = write((c, now) => {
      if (analysisId) return touched(c, { rootCauseId: analysisId }, now);
      const opened = findLink(c.sentTo, "root-cause");
      const sentTo = opened ? withoutLink(c.sentTo, opened) : c.sentTo;
      return touched(
        c,
        { rootCauseId: undefined, sentTo: sentTo && sentTo.length > 0 ? sentTo : undefined },
        now
      );
    });
    if (!saved) return;
    logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "rootCauseId" });
    announce(analysisId ? "Linked the Root Cause analysis." : "No longer linked to an analysis.");
  };

  /**
   * Open a Root Cause analysis of this improvement: the send writes the link
   * and rootCauseId in one write, so one Undo removes the analysis and both.
   */
  const analyzeInRootCause = (): string | null => {
    const cur = freshImprovement(itemId);
    if (!cur || example) return null;
    const link = sendHandoff(
      "root-cause",
      {
        title: cur.title,
        description: cur.background,
        sourceRef: { tool: IMPROVE_TOOL, id: cur.id },
      },
      {
        getLinks: () => freshImprovement(itemId)?.sentTo,
        setLinks: (update) =>
          write((c, now) => {
            const links = update(c.sentTo);
            return touched(
              c,
              {
                sentTo: links.length > 0 ? links : undefined,
                rootCauseId: findLink(links, "root-cause")?.targetId,
              },
              now
            );
          }),
      }
    );
    if (link) {
      logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "rootCauseId", route: "root-cause" });
      announce("Opened a Root Cause analysis of it. Find the cause there, then use it here.");
    }
    return link?.targetId ?? null;
  };

  /** Fill "Why it happens" from the linked analysis's root cause, with Undo. */
  const applyRootCause = (rootCause: string) => {
    const before = freshImprovement(itemId)?.analysis;
    const text = cleanText(rootCause, TOOL_TEXT_MAX.text);
    if (!text) return;
    undoable({
      label: "Filled in why it happens",
      description: `“${short(text)}”`,
      kind: "success",
      apply: () => {
        if (write((c, now) => touched(c, { analysis: text }, now))) {
          logIt(IMPROVE_ACTIONS.ITEM_UPDATED, { field: "analysis" });
        }
      },
      revert: () => write((c, now) => touched(c, { analysis: before }, now)),
    });
  };

  return {
    example,
    rowError,
    write,
    setTitle,
    setText,
    setPerson,
    setCondition,
    setStatus,
    addStep,
    patchStep,
    removeStep,
    stepLinks,
    addObstacle,
    patchObstacle,
    removeObstacle,
    obstacleLinks,
    addReading,
    removeReading,
    reachTarget,
    removePastTarget,
    saveCoaching,
    linkAnalysis,
    analyzeInRootCause,
    applyRootCause,
  };
}

export type ItemActions = ReturnType<typeof useItemActions>;
