"use client";

import { useMemo, useState } from "react";
import { Flag, Plus } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateOkrsPrompts } from "@/lib/ai-prompts/okrs";
import { OKR_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  isConfidence,
  krBaseline,
  krDirection,
  krPercent,
  lastCheckIn,
  objectiveProgress,
  replacesUndated,
  withCheckIn,
  withoutCheckIn,
} from "@/lib/okrs/progress";
import { normalizeQuarter } from "@/lib/roadmap/quarters";
import { emit as sonify } from "@/lib/sonification/emit";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  KeyResult,
  KeyResultCheckIn,
  Okr,
  Sprint,
  SprintGoal,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import { dayLabel } from "./chart-text";
import { buildExample } from "./example";
import {
  emptyObjective,
  newCheckIn,
  newKeyResult,
  newObjective,
  withKeyResultValues,
  withObjectiveValues,
  type KeyResultValues,
  type ObjectiveValues,
} from "./forms";
import { toMarkdown } from "./markdown";
import { ObjectiveCard } from "./objective-card";
import { ObjectiveForm } from "./objective-form";
import {
  ALL_QUARTERS,
  defaultQuarter,
  inQuarter,
  okrsVerdict,
  quarterChips,
  quarterKey,
} from "./view";

// Stable empty lists: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NO_OKRS: Okr[] = [];
const NO_GOALS: SprintGoal[] = [];
const NO_SPRINTS: Sprint[] = [];

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const sameIds = (a: readonly KeyResultCheckIn[] = [], b: readonly KeyResultCheckIn[] = []) =>
  a.length === b.length && a.every((c, i) => c.id === b[i].id);

/**
 * The key result back as `before` was (check-ins, current value and
 * confidence) when nothing changed its check-ins since `after`; otherwise
 * `fallback` (put the one check-in back, or take it out), so a check-in
 * someone added meanwhile survives the Undo. Restoring `before` matters:
 * a key result's first check-in replaces its typed current value, which
 * withoutCheckIn can't bring back.
 */
function undoCheckIns(
  live: KeyResult,
  before: KeyResult,
  after: KeyResult,
  fallback: (kr: KeyResult) => KeyResult
): KeyResult {
  if (!sameIds(live.checkIns, after.checkIns)) return fallback(live);
  const next: KeyResult = { ...live, checkIns: before.checkIns, current: before.current };
  if (before.confidence === undefined) delete next.confidence;
  else next.confidence = before.confidence;
  return next;
}

/** The changed keys of an edit, for the history log. */
function changed<T extends object>(before: T, after: T, keys: readonly (keyof T)[]): string[] {
  return keys.filter((k) => before[k] !== after[k]).map(String);
}

export function OkrsClient() {
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <OkrTracker />
    </TooltipProvider>
  );
}

/**
 * The OKR Tracker. Objectives belong to a quarter and an owner; each key
 * result runs from a baseline to a target, up or down, and moves through
 * dated check-ins, whose confidence draws the trend. The workspace store
 * is the one source (the agents' tool.okrs.* and Sprint Goal read it), and
 * every number on the page comes from lib/okrs.
 */
function OkrTracker() {
  const okrs = useWorkspaceStore((s) => s.okrs) ?? NO_OKRS;
  const goals = useWorkspaceStore((s) => s.sprintGoals) ?? NO_GOALS;
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const upsertOkr = useWorkspaceStore((s) => s.upsertOkr);
  const removeOkr = useWorkspaceStore((s) => s.removeOkr);
  const { log } = useHistoryLogger("okrs");
  const announce = useAnnounce();
  const [now] = useState(() => new Date());
  const today = todayLocalISO(now);
  const [creating, setCreating] = useState(false);
  // null until a chip is pressed: the list opens on today's quarter.
  const [chosen, setChosen] = useState<string | null>(null);

  const chips = useMemo(() => quarterChips(okrs, now), [okrs, now]);
  const filter =
    chosen !== null && (chosen === ALL_QUARTERS || chips.some((c) => c.key === chosen))
      ? chosen
      : defaultQuarter(okrs, now);
  const shown = useMemo(() => okrs.filter((o) => inQuarter(o, filter)), [okrs, filter]);
  const quarters = useMemo(() => okrs.map((o) => o.quarter), [okrs]);
  const verdict = okrsVerdict(shown, filter, today);
  const markdown = useMemo(
    () => toMarkdown(shown, now, { sprintGoals: goals, sprints }),
    [shown, now, goals, sprints]
  );
  const promptConfig = useMemo(
    () => ({ toolName: "OKR Tracker", prompts: generateOkrsPrompts({ okrs: shown }) }),
    [shown]
  );

  /** History for the team's own objectives; the example's edits aren't the team's work. */
  const record = (okrId: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(okrId)) log(action, payload);
  };

  /** Change one objective as it is in the store now; false when it's gone. */
  const write = (okrId: string, update: (o: Okr) => Okr): Okr | null => {
    const current = useWorkspaceStore.getState().okrs.find((o) => o.id === okrId);
    if (!current) return null;
    const next = update(current);
    upsertOkr(next);
    return next;
  };
  const writeKr = (okrId: string, krId: string, update: (kr: KeyResult) => KeyResult) =>
    write(okrId, (o) => ({
      ...o,
      keyResults: o.keyResults.map((k) => (k.id === krId ? update(k) : k)),
    }));
  const findKr = (okrId: string, krId: string) =>
    useWorkspaceStore
      .getState()
      .okrs.find((o) => o.id === okrId)
      ?.keyResults.find((k) => k.id === krId);

  /* ── Objectives ───────────────────────────────────────────────────── */

  const addObjective = (values: ObjectiveValues) => {
    const okr = newObjective(values);
    upsertOkr(okr);
    log(OKR_ACTIONS.OBJECTIVE_ADDED, { okrId: okr.id });
    setCreating(false);
    // The new objective stays in view, even when the list showed another quarter.
    if (filter !== ALL_QUARTERS && quarterKey(okr.quarter) !== filter) setChosen(okr.quarter);
    announce(`Added “${shortName(okr.objective)}” to ${okr.quarter}. Add its key results next.`);
  };

  const editObjective = (okrId: string, values: ObjectiveValues) => {
    const before = okrs.find((o) => o.id === okrId);
    const next = write(okrId, (o) => withObjectiveValues(o, values));
    if (!before || !next) return;
    const fields = changed(before, next, ["objective", "quarter", "owner", "description"]);
    if (fields.length > 0) record(okrId, OKR_ACTIONS.OBJECTIVE_UPDATED, { okrId, fields });
    announce(`Saved “${shortName(next.objective)}”`);
  };

  const deleteObjective = (okrId: string) => {
    const index = okrs.findIndex((o) => o.id === okrId);
    if (index === -1) return;
    const obj = okrs[index];
    undoable({
      label: obj.objective.trim()
        ? `Deleted “${shortName(obj.objective)}”`
        : "Deleted an untitled objective",
      apply: () => {
        removeOkr(okrId);
        record(okrId, OKR_ACTIONS.OBJECTIVE_REMOVED, { okrId, objective: obj.objective });
      },
      // Back with its key results and check-ins, at its old place in the list.
      revert: () => {
        const list = useWorkspaceStore.getState().okrs;
        if (list.some((o) => o.id === okrId)) return;
        const next = [...list];
        next.splice(Math.min(index, next.length), 0, obj);
        useWorkspaceStore.setState({ okrs: next });
      },
    });
    announce(`Deleted “${shortName(obj.objective || "untitled objective")}”`);
  };

  /* ── Key results ──────────────────────────────────────────────────── */

  const addKr = (okrId: string, values: KeyResultValues) => {
    const kr = newKeyResult(values);
    if (!write(okrId, (o) => ({ ...o, keyResults: [...o.keyResults, kr] }))) return;
    record(okrId, OKR_ACTIONS.KEY_RESULT_ADDED, { okrId, krId: kr.id });
    announce(`Added key result “${shortName(kr.title)}”`);
  };

  const editKr = (okrId: string, krId: string, values: KeyResultValues) => {
    const before = findKr(okrId, krId);
    if (!before) return;
    const after = withKeyResultValues(before, values);
    writeKr(okrId, krId, () => after);
    const fields = changed(before, after, [
      "title",
      "direction",
      "baseline",
      "target",
      "unit",
      "description",
    ]);
    if (fields.length > 0) {
      record(okrId, OKR_ACTIONS.KEY_RESULT_UPDATED, { okrId, krId, fields });
      // A new target or start moves progress: Epic Roadmap counts these.
      if (fields.includes("target") || fields.includes("baseline")) {
        record(okrId, OKR_ACTIONS.PROGRESS_UPDATED, {
          okrId,
          krId,
          target: after.target,
          baseline: after.baseline,
        });
      }
    }
    announce(`Saved key result “${shortName(after.title)}”`);
  };

  const deleteKr = (okrId: string, krId: string) => {
    const parent = okrs.find((o) => o.id === okrId);
    const index = parent?.keyResults.findIndex((k) => k.id === krId) ?? -1;
    if (!parent || index === -1) return;
    const kr = parent.keyResults[index];
    undoable({
      label: kr.title.trim()
        ? `Deleted “${shortName(kr.title)}”`
        : "Deleted an untitled key result",
      apply: () => {
        write(okrId, (o) => ({ ...o, keyResults: o.keyResults.filter((k) => k.id !== krId) }));
        record(okrId, OKR_ACTIONS.KEY_RESULT_REMOVED, { okrId, krId });
      },
      // Back into its objective at its old position, with its check-ins,
      // keeping edits made to the others since. Nothing to do if the
      // objective itself was deleted meanwhile.
      revert: () => {
        const live = useWorkspaceStore.getState().okrs.find((o) => o.id === okrId);
        if (!live || live.keyResults.some((k) => k.id === krId)) return;
        const keyResults = [...live.keyResults];
        keyResults.splice(Math.min(index, keyResults.length), 0, kr);
        upsertOkr({ ...live, keyResults });
      },
    });
    announce(`Deleted key result “${shortName(kr.title || "untitled")}”`);
  };

  /* ── Check-ins ────────────────────────────────────────────────────── */

  const checkIn = (okrId: string, krId: string, values: Omit<KeyResultCheckIn, "id">) => {
    const okr = useWorkspaceStore.getState().okrs.find((o) => o.id === okrId);
    const before = okr?.keyResults.find((k) => k.id === krId);
    if (!okr || !before) return;
    const entry = newCheckIn(values);
    const after = withCheckIn(before, entry);
    // The form refuses a day older than a full history keeps; this is the backstop.
    if (!(after.checkIns ?? []).some((c) => c.id === entry.id)) {
      toast.error("That day is older than every check-in kept, so it wasn't saved.");
      return;
    }
    const replaced = replacesUndated(before, entry, today);
    const wasDone = objectiveProgress(okr) >= 1;
    const next = write(okrId, (o) => ({
      ...o,
      keyResults: o.keyResults.map((k) => (k.id === krId ? after : k)),
    }));
    if (!next) return;
    const example = isExampleId(okrId);
    const title = shortName(before.title || "key result");
    undoable({
      label: `Checked in “${title}”`,
      description: replaced
        ? `Its first check-in, dated ${dayLabel(entry.date)}, replaced ${[
            replaced.current !== null ? `the current value ${replaced.current}` : "",
            replaced.confidence !== null ? `the confidence ${replaced.confidence}` : "",
          ]
            .filter(Boolean)
            .join(" and ")} typed before. If that was newer, check it in for today too.`
        : undefined,
      apply: () => {
        if (example) return;
        record(okrId, OKR_ACTIONS.CHECK_IN_RECORDED, {
          okrId,
          krId,
          checkInId: entry.id,
          date: entry.date,
          value: entry.value,
          confidence: entry.confidence,
        });
        // Epic Roadmap's "OKR progress this fortnight" counts these.
        record(okrId, OKR_ACTIONS.PROGRESS_UPDATED, { okrId, krId, current: after.current });
        sonify("okrs", "kr-updated");
        if (!wasDone && objectiveProgress(next) >= 1) sonify("okrs", "okr-achieved");
      },
      revert: () =>
        writeKr(okrId, krId, (live) =>
          undoCheckIns(live, before, after, (kr) => withoutCheckIn(kr, entry.id))
        ),
    });
    const latest = lastCheckIn(after);
    announce(
      latest?.id === entry.id
        ? `Checked in “${title}”: now ${krPercent(after)}% of the way`
        : `Checked in “${title}” for ${dayLabel(entry.date)}; a newer check-in still sets its value`
    );
  };

  const removeCheckIn = (okrId: string, krId: string, c: KeyResultCheckIn) => {
    const before = findKr(okrId, krId);
    if (!before) return;
    const after = withoutCheckIn(before, c.id);
    if (after === before) return;
    const title = shortName(before.title || "key result");
    undoable({
      label: `Deleted the check-in of ${dayLabel(c.date)} on “${title}”`,
      apply: () => {
        writeKr(okrId, krId, () => after);
        record(okrId, OKR_ACTIONS.CHECK_IN_REMOVED, { okrId, krId, checkInId: c.id, date: c.date });
      },
      revert: () =>
        writeKr(okrId, krId, (live) =>
          undoCheckIns(live, before, after, (kr) => withCheckIn(kr, c))
        ),
    });
    announce(`Deleted the check-in of ${dayLabel(c.date)}`);
  };

  /* ── Example ──────────────────────────────────────────────────────── */

  // Example objectives are written like any other but never logged: loading
  // an example isn't the user's own planning work.
  const loadExample = () => {
    for (const o of buildExample(now)) upsertOkr(o);
    setChosen(null);
  };
  const clearExample = () => {
    for (const o of useWorkspaceStore.getState().okrs) if (isExampleId(o.id)) removeOkr(o.id);
    setChosen(null);
  };

  return (
    <ToolPageWrapper
      toolId="okrs"
      title="OKR Tracker"
      description="Quarterly Objectives and Key Results, each measured from its baseline to its target through dated check-ins with a confidence score."
      category="Outcomes & Pulse"
    >
      {hasExampleItems(okrs) && <ExampleNotice onClear={clearExample} />}
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="okrs"
          csvData={{
            headers: [
              "Quarter",
              "Objective",
              "Owner",
              "Objective Description",
              "KR",
              "KR Description",
              "Direction",
              "Baseline",
              "Current",
              "Target",
              "Unit",
              "Progress %",
              "Confidence",
              "Last check-in",
            ],
            rows: shown.flatMap((o) =>
              o.keyResults.map((kr) => [
                quarterKey(o.quarter),
                o.objective,
                o.owner ?? "",
                o.description ?? "",
                kr.title,
                kr.description ?? "",
                krDirection(kr),
                krBaseline(kr) ?? "",
                kr.current,
                kr.target,
                kr.unit ?? "",
                krPercent(kr),
                isConfidence(kr.confidence) ? kr.confidence : "",
                lastCheckIn(kr)?.date ?? "",
              ])
            ),
          }}
          jsonData={okrs}
          markdown={markdown}
          shareState={okrs}
        />
        <Button
          type="button"
          onClick={() => setCreating((c) => !c)}
          aria-expanded={creating}
          className="gap-2 bg-accent text-bg hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New objective
        </Button>
      </ActionRow>

      <div className="space-y-4">
        {creating && (
          <SectionCard title="New objective" icon={Flag}>
            <ObjectiveForm
              initial={emptyObjective(filter === ALL_QUARTERS ? "" : normalizeQuarter(filter))}
              quarters={quarters}
              submitLabel="Add objective"
              onSave={addObjective}
              onCancel={() => setCreating(false)}
            />
          </SectionCard>
        )}

        {okrs.length === 0 ? (
          !creating && (
            <EmptyState icon={Flag} action={<LoadExampleButton onLoad={loadExample} />}>
              No objectives yet. Press &ldquo;New objective&rdquo; to set one for a quarter, then
              give it key results measured from where they start.
            </EmptyState>
          )
        ) : (
          <>
            <p className="text-sm font-medium text-text">{verdict}</p>
            {chips.length > 1 && (
              <div role="group" aria-label="Quarter" className="flex flex-wrap gap-1">
                {chips.map((c) => (
                  <Button
                    key={c.key}
                    type="button"
                    size="sm"
                    variant={filter === c.key ? "default" : "outline"}
                    aria-pressed={filter === c.key}
                    onClick={() => setChosen(c.key)}
                  >
                    {c.key}
                    {c.current && <span className="ml-1 text-xs opacity-80">(this quarter)</span>}
                    <span className="ml-1 font-mono text-xs opacity-80">{c.count}</span>
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={filter === ALL_QUARTERS ? "default" : "outline"}
                  aria-pressed={filter === ALL_QUARTERS}
                  onClick={() => setChosen(ALL_QUARTERS)}
                >
                  All
                  <span className="ml-1 font-mono text-xs opacity-80">{okrs.length}</span>
                </Button>
              </div>
            )}
            <div className="space-y-4">
              {shown.map((o) => (
                <ObjectiveCard
                  key={o.id}
                  okr={o}
                  now={now}
                  today={today}
                  quarters={quarters}
                  goals={goals}
                  sprints={sprints}
                  example={isExampleId(o.id)}
                  handlers={{
                    onEdit: (v) => editObjective(o.id, v),
                    onDelete: () => deleteObjective(o.id),
                    onAddKr: (v) => addKr(o.id, v),
                    onEditKr: (krId, v) => editKr(o.id, krId, v),
                    onDeleteKr: (krId) => deleteKr(o.id, krId),
                    onCheckIn: (krId, v) => checkIn(o.id, krId, v),
                    onRemoveCheckIn: (krId, c) => removeCheckIn(o.id, krId, c),
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
