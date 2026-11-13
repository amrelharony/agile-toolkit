"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { CalendarCheck, ClipboardList, Plus } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { useStableOrder } from "@/hooks/use-stable-order";
import type { AiSource } from "@/lib/ai/task-types";
import { meetingAuditSuggestTask } from "@/lib/ai/tasks/meeting-audit";
import { generateMeetingAuditPrompts } from "@/lib/ai-prompts/meeting-audit";
import { cheer } from "@/lib/celebrate/cheer";
import { MEETING_AUDIT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MeetingAudit, MeetingVerdict } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  auditSummary,
  auditVerdict,
  byCost,
  countedAudits,
  editedMeetingAudit,
  matchChanges,
  meetingAudits,
  newMeetingAudit,
  normalizeMeetingAudit,
  ratedCount,
  resetPlan,
  weeklyHours,
  weeklyText,
  withChange,
  withRating,
  type MeetingChange,
  type MeetingValues,
} from "@/lib/meeting-audit/model";
import { buildExample } from "./example";
import { toCsv, toMarkdown } from "./markdown";
import { MeetingCard, shortName } from "./meeting-card";
import { MeetingForm } from "./meeting-form";
import { currentAudits, findAudit, removeAudit, saveAudit } from "./store";
import { auditAiInput, changedFields } from "./view";

export const TOOL_ID = "meeting-audit";

const keyOf = (a: MeetingAudit) => a.id;
const nowIso = () => new Date().toISOString();

/** A suggestion as the page shows it: with the meeting's name when it was asked. */
interface ShownChange extends MeetingChange {
  meeting: string;
}

/** Focus the name of the meeting with `id` (or `fallback`) once React has re-rendered. */
function focusSoon(id: string | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = id
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-meeting-name]")).find(
          (e) => e.getAttribute("data-meeting-name") === id
        )
      : undefined;
    (el ?? fallback)?.focus();
  });
}

/** The meeting with its verdict set, or cleared (null). Stamps updatedAt. */
function withVerdict(a: MeetingAudit, verdict: MeetingVerdict | null): MeetingAudit {
  const next: MeetingAudit = { ...a, updatedAt: nowIso() };
  if (verdict) next.verdict = verdict;
  else delete next.verdict;
  return next;
}

/**
 * Meeting Audit (on the More tools shelf): the team's recurring meetings one
 * by one, what each costs in person-hours a week (attendees × minutes × how
 * often), the team's ratings on five questions, a verdict to keep, change or
 * drop, and the ritual reset plan those verdicts add up to. Amr suggests
 * concrete changes; each accepted one goes into that meeting's notes with
 * Undo. Everything lives in workspace.meetingAudits, which the agent verbs
 * and the next step read too.
 */
export function MeetingAuditClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.meetingAudits);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [now] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{
    items: ShownChange[];
    source: AiSource;
  } | null>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  /** Holds "Suggest changes" and its list: focus goes back to the button on Dismiss. */
  const aiRef = useRef<HTMLDivElement>(null);
  const resetSnapshot = useRef<MeetingAudit[]>([]);

  const audits = useMemo(() => meetingAudits(raw), [raw]);
  // The costliest first; a rating or an edit doesn't move a card from under
  // the cursor ("Re-sort" catches the order up).
  const { ordered, isStale, resort } = useStableOrder(audits, keyOf, byCost);
  const counted = useMemo(() => countedAudits(audits), [audits]);
  const summary = auditSummary(counted);
  const verdict = auditVerdict(summary);
  const plan = resetPlan(counted);
  const hasExample = hasExampleItems(audits);
  const exampleOnly = audits.length > 0 && audits.every((a) => isExampleId(a.id));
  const markdown = useMemo(() => toMarkdown(counted, now), [counted, now]);
  const csv = useMemo(() => toCsv(counted), [counted]);
  const promptConfig = useMemo(
    () => ({ toolName: "Meeting Audit", prompts: generateMeetingAuditPrompts(counted) }),
    [counted]
  );
  const anyRated = counted.some((a) => ratedCount(a) > 0 || a.verdict);

  /* ── Changes ──────────────────────────────────────────────────────── */

  // The example's meetings aren't the team's history.
  const record = (
    a: Pick<MeetingAudit, "id">,
    action: string,
    payload: Record<string, unknown>
  ) => {
    if (!isExampleId(a.id)) log(action, payload);
  };

  /** Amr's cheer once every one of the team's own meetings has a verdict: the plan is ready. */
  const cheerIfAllDecided = () => {
    const own = meetingAudits(currentAudits()).filter((x) => !isExampleId(x.id));
    if (own.length > 0 && own.every((x) => x.verdict)) cheer(TOOL_ID, "done");
  };

  const add = (values: MeetingValues) => {
    const a = saveAudit(newMeetingAudit(values, `meeting_${nanoid(8)}`, nowIso()));
    record(a, MEETING_AUDIT_ACTIONS.MEETING_ADDED, { meetingId: a.id, meeting: a.meeting });
    announce(`Added “${shortName(a.meeting)}”: ${weeklyText(weeklyHours(a))}`);
  };

  const rate = (a: MeetingAudit, questionId: string, value: number | null) => {
    const prev = findAudit(a.id);
    if (!prev) return;
    saveAudit({
      ...prev,
      ratings: withRating(prev.ratings, questionId, value),
      updatedAt: nowIso(),
    });
    record(a, MEETING_AUDIT_ACTIONS.MEETING_RATED, {
      meetingId: a.id,
      question: questionId,
      rating: value,
    });
  };

  const setVerdict = (a: MeetingAudit, v: MeetingVerdict | null) => {
    const prev = findAudit(a.id);
    if (!prev || (prev.verdict ?? null) === v) return;
    saveAudit(withVerdict(prev, v));
    record(a, MEETING_AUDIT_ACTIONS.VERDICT_SET, { meetingId: a.id, verdict: v });
    announce(
      v ? `${shortName(a.meeting)}: ${v}` : `Cleared the verdict for ${shortName(a.meeting)}`
    );
    if (v && !isExampleId(a.id)) cheerIfAllDecided();
  };

  const save = (a: MeetingAudit, values: MeetingValues) => {
    const prev = findAudit(a.id);
    setEditingId(null);
    if (prev) {
      const fields = changedFields(prev, values);
      if (fields.length > 0) {
        saveAudit(editedMeetingAudit(prev, values, nowIso()));
        record(a, MEETING_AUDIT_ACTIONS.MEETING_UPDATED, { meetingId: a.id, fields });
        announce(`Saved “${shortName(values.meeting)}”`);
      }
    }
    focusSoon(a.id);
  };

  const startEdit = (a: MeetingAudit | null) => {
    const closing = editingId;
    setEditingId(a?.id ?? null);
    if (a) setRatingId(null);
    if (!a && closing) focusSoon(closing);
  };

  const toggleRating = (a: MeetingAudit | null) => setRatingId(a?.id ?? null);

  const remove = (a: MeetingAudit) => {
    let snapshot: MeetingAudit | null = null;
    const at = ordered.findIndex((x) => x.id === a.id);
    const neighbour = ordered[at + 1] ?? ordered[at - 1];
    const label = `Deleted “${shortName(a.meeting)}”`;
    undoable({
      label,
      apply: () => {
        snapshot = removeAudit(a.id);
        record(a, MEETING_AUDIT_ACTIONS.MEETING_REMOVED, { meetingId: a.id });
      },
      revert: () => {
        if (snapshot) saveAudit(snapshot);
        focusSoon(a.id);
      },
    });
    if (editingId === a.id) setEditingId(null);
    if (ratingId === a.id) setRatingId(null);
    focusSoon(neighbour?.id ?? null, newRef.current);
    announce(label);
  };

  /** An accepted change: into the meeting's notes, its verdict to change, with Undo. */
  const acceptChanges = (list: readonly MeetingChange[]) => {
    const prevs = new Map<string, MeetingAudit>();
    for (const c of list) {
      const a = findAudit(c.meetingId);
      if (a && !prevs.has(a.id)) prevs.set(a.id, a);
    }
    const todo = list.filter((c) => prevs.has(c.meetingId));
    if (todo.length === 0) {
      announce("That meeting is no longer in the audit.");
      return;
    }
    const first = prevs.get(todo[0].meetingId)!;
    const label =
      todo.length === 1
        ? `Added “${todo[0].change}” to ${shortName(first.meeting)}`
        : `Added ${todo.length} changes to the plan`;
    undoable({
      label,
      apply: () => {
        const at = nowIso();
        let verdictGiven = false;
        for (const c of todo) {
          const current = normalizeMeetingAudit(findAudit(c.meetingId));
          if (!current) continue;
          const next = withChange(current, c.change, at);
          saveAudit(next);
          record(current, MEETING_AUDIT_ACTIONS.MEETING_UPDATED, {
            meetingId: current.id,
            fields: ["notes"],
          });
          if (next.verdict !== current.verdict) {
            record(current, MEETING_AUDIT_ACTIONS.VERDICT_SET, {
              meetingId: current.id,
              verdict: next.verdict,
            });
            if (!isExampleId(current.id)) verdictGiven = true;
          }
        }
        // The last meeting may get its verdict from a change: the same cheer as setVerdict's.
        if (verdictGiven) cheerIfAllDecided();
      },
      revert: () => {
        prevs.forEach((p) => saveAudit(p));
      },
    });
    announce(label);
  };

  const newRound = () => {
    resetSnapshot.current = counted
      .map((a) => findAudit(a.id))
      .filter((a): a is MeetingAudit => Boolean(a));
    const at = nowIso();
    for (const a of resetSnapshot.current) {
      const next: MeetingAudit = { ...a, ratings: {}, updatedAt: at };
      delete next.verdict;
      saveAudit(next);
    }
    const own = resetSnapshot.current.filter((a) => !isExampleId(a.id)).length;
    if (own > 0) log(MEETING_AUDIT_ACTIONS.AUDIT_RESET, { count: own });
    setSuggestions(null);
    // "Start a new round" goes with the ratings (and its dialog with it): the
    // round starts at the costliest meeting, or "Add meeting".
    focusSoon(ordered[0]?.id ?? null, newRef.current);
  };
  const undoNewRound = () => {
    resetSnapshot.current.forEach(saveAudit);
    resetSnapshot.current = [];
  };

  // Loading is offered on an empty audit only, and neither it nor its
  // clearing is logged: the example isn't the team's work.
  const loadExample = () => {
    buildExample(new Date()).forEach(saveAudit);
    setFormOpen(false);
  };
  const clearExample = () => {
    let removed: MeetingAudit[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentAudits()
          .filter((a) => isExampleId(a.id))
          .map((a) => removeAudit(a.id))
          .filter((a): a is MeetingAudit => a !== null);
      },
      revert: () => removed.forEach(saveAudit),
    });
    setSuggestions(null);
    focusSoon(null, newRef.current);
  };

  return (
    <ToolPageWrapper
      toolId="meeting-audit"
      title="Meeting Audit"
      description="Audit your recurring meetings: what each one costs in time and people, whether it earns its place, keep, change or drop."
      category="Continuous Improvement"
    >
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the meeting audit…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExample && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: a product team&apos;s recurring calendar, half audited
                {exampleOnly ? "" : ". It isn't counted while you have meetings of your own"}.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {audits.length > 0 && (
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="meeting-audit"
                  markdown={markdown}
                  clipboardText={markdown}
                  csvData={csv}
                  jsonData={counted}
                />
              </>
            )}
            <Button
              ref={newRef}
              type="button"
              size="sm"
              className="gap-1"
              aria-expanded={formOpen}
              onClick={() => setFormOpen((o) => !o)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add meeting
            </Button>
          </div>

          {formOpen && (
            <SectionCard title="Add a recurring meeting" icon={Plus}>
              <MeetingForm
                submitLabel="Add meeting"
                submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                autoFocus
                onSave={add}
                onCancel={() => {
                  setFormOpen(false);
                  newRef.current?.focus();
                }}
              />
            </SectionCard>
          )}

          {audits.length === 0 ? (
            !formOpen && (
              <EmptyState icon={CalendarCheck} action={<LoadExampleButton onLoad={loadExample} />}>
                No meetings audited yet. Use &ldquo;Add meeting&rdquo; for each recurring meeting
                the team has: the audit works out what it costs, and the team rates whether it earns
                its place.
              </EmptyState>
            )
          ) : (
            <>
              <p className="text-sm font-medium text-text">{verdict}</p>

              <KpiGrid cols={4} marginBottom="none">
                <StatCard
                  variant="compact"
                  label="Meetings"
                  value={summary.meetings}
                  hint="Recurring"
                />
                <StatCard
                  variant="compact"
                  label="Hours a week"
                  value={Math.round(summary.weeklyHours * 10) / 10}
                  hint="Person-hours, all meetings"
                />
                <StatCard
                  variant="compact"
                  label="Rated"
                  value={`${summary.rated} of ${summary.meetings}`}
                  hint="With the team"
                />
                <StatCard
                  variant="compact"
                  label="Freed by drops"
                  value={Math.round(summary.hoursFreed * 10) / 10}
                  hint="Person-hours a week"
                />
              </KpiGrid>

              <div ref={aiRef} className="space-y-2">
                <AiButton
                  task={meetingAuditSuggestTask}
                  input={() => {
                    const ids = new Set(counted.map((a) => a.id));
                    return auditAiInput(ordered.filter((a) => ids.has(a.id)));
                  }}
                  onResult={(data, meta) => {
                    const names = new Map(audits.map((a) => [a.id, a.meeting]));
                    const items = matchChanges(data.changes, audits).map((c) => ({
                      ...c,
                      meeting: names.get(c.meetingId) ?? "",
                    }));
                    setSuggestions({ items, source: meta.source });
                  }}
                  label="Ask Amr for changes"
                  fallbackLabel="Suggest changes"
                />
                {suggestions &&
                  (suggestions.items.length > 0 ? (
                    <AiSuggestions
                      items={suggestions.items}
                      title="Changes to try"
                      acceptLabel="Add to plan"
                      source={suggestions.source}
                      render={(c) => ({
                        title: `${shortName(c.meeting, 60)}: ${c.change}`,
                        detail: c.why,
                      })}
                      onAccept={(c) => acceptChanges([c])}
                      onAcceptAll={(list) => acceptChanges(list)}
                      onDismiss={() => {
                        // Before the list (and its focused Dismiss) goes: back to the button.
                        aiRef.current?.querySelector<HTMLElement>("button")?.focus();
                        setSuggestions(null);
                      }}
                    />
                  ) : (
                    <p role="status" className="text-xs text-sub">
                      No change to suggest yet. Rate the meetings first: the suggestions come from
                      the ratings.
                    </p>
                  ))}
              </div>

              <ResortChip isStale={isStale} onResort={resort} what="Lengths or headcounts" />
              <ul className="space-y-2" aria-label="Recurring meetings, the costliest first">
                {ordered.map((a) => (
                  <MeetingCard
                    key={a.id}
                    audit={a}
                    rating={ratingId === a.id}
                    editing={editingId === a.id}
                    onRate={rate}
                    onToggleRating={toggleRating}
                    onVerdict={setVerdict}
                    onEdit={startEdit}
                    onSave={save}
                    onDelete={remove}
                  />
                ))}
              </ul>

              <SectionCard
                title="Ritual reset plan"
                icon={ClipboardList}
                actions={
                  anyRated ? (
                    <ResetButton
                      label="Start a new round"
                      title="Start a new round of the audit?"
                      description="Every meeting's ratings and verdict are cleared, so the team can rate them afresh. The meetings and their notes stay. Export the audit first to keep this round."
                      confirmLabel="Start a new round"
                      doneLabel="Started a new round"
                      onReset={newRound}
                      onUndo={undoNewRound}
                    />
                  ) : undefined
                }
              >
                <ResetPlanView plan={plan} />
              </SectionCard>
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}

/** The verdicts as a plan: what stays, what changes (and how), what goes and what it frees. */
function ResetPlanView({ plan }: { plan: ReturnType<typeof resetPlan> }) {
  const groups: {
    key: string;
    title: string;
    list: MeetingAudit[];
    detail: (a: MeetingAudit) => string;
  }[] = [
    {
      key: "change",
      title: "Change",
      list: plan.change,
      detail: (a) =>
        a.notes?.trim() || "What to change isn't written yet: edit the meeting to add it.",
    },
    {
      key: "drop",
      title: "Drop",
      list: plan.drop,
      detail: (a) => `Frees ${weeklyText(weeklyHours(a))}.`,
    },
    { key: "keep", title: "Keep", list: plan.keep, detail: () => "" },
    { key: "undecided", title: "No verdict yet", list: plan.undecided, detail: () => "" },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-text">
        Now {weeklyText(plan.hoursNow)}.{" "}
        {plan.hoursFreed > 0
          ? `After the drops, ${weeklyText(plan.hoursAfter)}.`
          : "Mark a meeting to drop to see the time it frees."}
      </p>
      {groups
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.key}>
            <h3 className="text-xs font-semibold text-sub">
              {g.title} ({g.list.length})
            </h3>
            <ul className="mt-1 space-y-1">
              {g.list.map((a) => {
                const detail = g.detail(a);
                return (
                  <li key={a.id} className="break-words text-sm text-text">
                    <span className="font-medium">{a.meeting}</span>
                    {detail && <span className="whitespace-pre-line text-sub"> — {detail}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      <p className="text-xs text-sub">
        Try each change for a few weeks before judging it, and change how a Scrum event runs before
        dropping it.
      </p>
    </div>
  );
}
