"use client";

import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { FileText, Plus, Timer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateDaciPrompts } from "@/lib/ai-prompts/daci";
import { generateDecisionLogPrompts } from "@/lib/ai-prompts/decision-log";
import { generateRapidPrompts } from "@/lib/ai-prompts/rapid-decision";
import {
  decisionLabel,
  decisionVerdict,
  isDecided,
  templateOf,
  timeToDecide,
} from "@/lib/decisions/model";
import {
  createDecision,
  newDecisionId,
  removeDecisionRecord,
  restoreDecisionRecord,
  saveDecision,
  saveDecisions,
  type DecisionRecordSnapshot,
} from "@/lib/decisions/store";
import { DECISION_STATUS_LABEL, TEMPLATES } from "@/lib/decisions/templates";
import type { DecisionLogConflict } from "@/lib/decisions/legacy-log";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision, DecisionStatus, DecisionTemplate } from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { ConflictNotice, withOldText } from "./conflict-notice";
import { DecisionCard, type ChangeHow } from "./decision-card";
import { DecisionForm, type NewDecision } from "./decision-form";
import { buildExample } from "./example";
import { decisionsToMarkdown } from "./markdown";
import { TemplateSwitch } from "./template-switch";
import { useLegacyDecisions } from "./use-legacy-decisions";
import {
  HISTORY,
  PAGE,
  byNumberDesc,
  countByTemplate,
  decisionsCsv,
  matchesTemplate,
  type TemplateFilter,
} from "./view";

/** `?id=<record>` opens one record (the hand-offs' and next steps' "Open"). */
export const RECORD_PARAM = "id";

/** `?id=` from a query string, or null. */
export function readRecordParam(search: string): string | null {
  const v = new URLSearchParams(search).get(RECORD_PARAM);
  return v && v.length <= 128 ? v : null;
}

const STATUSES: DecisionStatus[] = ["proposed", "accepted", "deprecated", "superseded"];
const FILTERS: readonly TemplateFilter[] = ["all", "adr", "daci", "rapid"];
const NOTHING_OPEN: ReadonlySet<string> = new Set();

/**
 * The decision log: one list of records for the Decision Log (ADR), DACI
 * and RAPID, each route opening with its own form as the default for New.
 * Records are numbered in one sequence (ADR-0003, DACI-0004), edited in
 * place, decided with the outcome and the decider, superseded both ways,
 * and deleted with Undo. The old DACI and RAPID rows and the old Decision
 * Log's own storage move in once (useLegacyDecisions).
 */
export function DecisionLogClient({ template = "adr" }: { template?: DecisionTemplate }) {
  const page = PAGE[template];
  const spec = TEMPLATES[template];
  const hydrated = useWorkspaceHydrated();
  const { records, pending, conflicts, settleConflict } = useLegacyDecisions();
  const roster = useTeamRoster();
  const { log } = useHistoryLogger(page.toolId);
  const history = HISTORY[template];
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [filter, setFilter] = useState<TemplateFilter>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(NOTHING_OPEN);
  const [formOpen, setFormOpen] = useState(false);
  // The record to scroll to once it is on screen (from ?id= or a "Supersedes" link).
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const filterId = useId();
  // The New button at the top, where focus goes back when the form is cancelled.
  const newRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = readRecordParam(window.location.search);
    if (!id) return;
    setOpen((s) => new Set(s).add(id));
    setJumpTo(id);
  }, []);

  const shown = useMemo(() => records.filter((d) => matchesTemplate(d, filter)), [records, filter]);
  const { ordered, isStale, resort } = useStableOrder(shown, (d) => d.id, byNumberDesc);

  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`decision-${jumpTo}`);
    if (!el) return;
    el.scrollIntoView?.({ block: "start", behavior: "smooth" });
    el.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
    setJumpTo(null);
  }, [jumpTo, ordered]);

  const counts = useMemo(() => countByTemplate(records), [records]);
  const byStatus = useMemo(() => {
    const c: Record<DecisionStatus, number> = {
      proposed: 0,
      accepted: 0,
      deprecated: 0,
      superseded: 0,
    };
    // A status outside the lifecycle (a hand-edited row) isn't counted, never NaN.
    for (const d of records) if (d.status in c) c[d.status] += 1;
    return c;
  }, [records]);
  const verdict = decisionVerdict(records, today);
  const real = useMemo(() => records.filter((d) => !isExampleId(d.id)), [records]);
  const speed = timeToDecide(real);
  const decidedWithDays = real.filter((d) => isDecided(d.status) && d.decidedAt && d.date).length;

  const markdown = decisionsToMarkdown(ordered, {
    all: records,
    verdict,
    title: filter === "all" ? "Decision Log" : `Decision Log: ${TEMPLATES[filter].label} records`,
  });

  const promptConfig = useMemo(() => {
    // The records themselves (numbers, lifecycle, the template's roles), as the cards show them:
    // DACI and RAPID list their own records with their roles, the log lists every record, and
    // all three state the verdict and time to decide over the whole log, as the page does.
    const own = records.filter((d) => templateOf(d) === template);
    return {
      toolName: page.title,
      prompts:
        template === "daci"
          ? generateDaciPrompts({ decisions: own, all: records, today })
          : template === "rapid"
            ? generateRapidPrompts({ decisions: own, all: records, today })
            : generateDecisionLogPrompts({ decisions: records, today }),
    };
  }, [records, template, page.title, today]);

  /* ── Changes ──────────────────────────────────────────────────────── */

  // Example records aren't the team's history.
  const record = (d: { id: string }, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(d.id)) log(action, payload);
  };

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const jump = (id: string) => {
    setFilter("all");
    setOpen((s) => new Set(s).add(id));
    setJumpTo(id);
  };

  const create = (id: string, values: NewDecision) => {
    let created: Decision | null = null;
    undoable({
      label: `Added “${values.title}”`,
      apply: () => {
        created = createDecision({ ...values, id });
        record(created, history.added, {
          decisionId: id,
          title: values.title,
          template: values.template,
        });
      },
      revert: () => {
        removeDecisionRecord(id);
      },
    });
    setFormOpen(false);
    setFilter("all");
    setOpen((s) => new Set(s).add(id));
    setJumpTo(id);
    const saved = created as Decision | null;
    announce(`Added ${saved ? decisionLabel(saved) : "the record"}: ${values.title}`);
  };

  const change = (prev: Decision, next: Decision, how: ChangeHow) => {
    if (how.undo) {
      undoable({
        label: how.label,
        apply: () => saveDecision(next),
        revert: () => saveDecision(prev),
      });
    } else {
      saveDecision(next);
    }
    record(prev, how.decided ? history.decided : history.updated, {
      decisionId: prev.id,
      title: next.title,
      ...(prev.status !== next.status ? { from: prev.status, to: next.status } : {}),
    });
    announce(how.label);
  };

  const remove = (d: Decision) => {
    const label = decisionLabel(d);
    let snapshot: DecisionRecordSnapshot | null = null;
    // Focus moves to the next record on screen (or the one before) as this one goes.
    const at = ordered.findIndex((x) => x.id === d.id);
    const neighbour = ordered[at + 1] ?? ordered[at - 1];
    undoable({
      label: `Deleted ${label}`,
      description: `“${d.title || "Untitled"}”`,
      apply: () => {
        snapshot = removeDecisionRecord(d.id);
        record(d, history.removed, { decisionId: d.id, title: d.title });
      },
      revert: () => {
        if (snapshot) restoreDecisionRecord(snapshot);
        setJumpTo(d.id);
      },
    });
    if (neighbour) setJumpTo(neighbour.id);
    announce(`Deleted ${label}`);
  };

  const takeOldText = (c: DecisionLogConflict) => {
    const d = records.find((x) => x.id === c.id);
    settleConflict(c);
    if (!d) return;
    const next = withOldText(d, c);
    undoable({
      label: `Used the old page's text on ${decisionLabel(d)}`,
      apply: () => saveDecision(next),
      revert: () => saveDecision(d),
    });
    announce(`Used the old page's text on ${decisionLabel(d)}`);
  };

  const loadExample = () => {
    saveDecisions(buildExample(today));
    setFilter("all");
  };
  const clearExample = () => {
    useWorkspaceStore.setState((s) => ({
      decisions: (s.decisions ?? []).filter((d) => !isExampleId(d.id)),
    }));
    setOpen(NOTHING_OPEN);
  };

  const newButton = (ref?: Ref<HTMLButtonElement>) => (
    <Button
      ref={ref}
      type="button"
      size="sm"
      className="gap-1"
      aria-expanded={formOpen}
      onClick={() => setFormOpen((o) => !o)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      New {spec.label}
    </Button>
  );

  return (
    <ToolPageWrapper toolId={page.toolId} title={page.title} description={page.description}>
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading decisions…
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TemplateSwitch template={template} />
            <div className="flex flex-wrap items-center gap-2">
              {records.length > 0 && (
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="decision-log"
                    markdown={markdown}
                    clipboardText={markdown}
                    csvData={decisionsCsv(ordered, records)}
                    jsonData={ordered}
                  />
                </>
              )}
              {newButton(newRef)}
            </div>
          </div>

          {hasExampleItems(records) && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: a platform team&apos;s log, one record per form. Its numbers aren&apos;t
                part of your log&apos;s sequence.
              </p>
            </div>
          )}

          <ConflictNotice
            conflicts={conflicts}
            records={records}
            onKeep={settleConflict}
            onUseOld={takeOldText}
          />

          {pending && (
            <p role="status" className="text-xs text-sub">
              Some records from the old Decision Log are still moving in; they&apos;re listed as
              they&apos;ll read once moved.
            </p>
          )}

          {formOpen && (
            <SectionCard title={`New ${spec.label} record`} icon={Plus}>
              <DecisionForm
                template={template}
                today={today}
                roster={roster}
                newId={newDecisionId}
                onSave={create}
                onCancel={() => {
                  setFormOpen(false);
                  newRef.current?.focus();
                }}
              />
            </SectionCard>
          )}

          {records.length === 0 ? (
            !formOpen && (
              <EmptyState
                icon={FileText}
                action={
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {newButton()}
                    <LoadExampleButton onLoad={loadExample} />
                  </div>
                }
              >
                No decisions recorded yet. Raise one in the {spec.label} form, or load an example to
                see a log with all three forms. Decisions sent from Six Hats, RFC Tracker and the
                Weighted Decision Matrix land here too.
              </EmptyState>
            )
          ) : (
            <>
              <p className="text-sm font-medium text-text">{verdict}</p>
              <KpiGrid cols={4}>
                {STATUSES.map((s) => (
                  <StatCard
                    key={s}
                    variant="compact"
                    label={DECISION_STATUS_LABEL[s]}
                    value={byStatus[s]}
                  />
                ))}
              </KpiGrid>

              <div>
                <p id={filterId} className="mb-1 text-xs font-medium text-sub">
                  Show
                </p>
                <div role="group" aria-labelledby={filterId} className="flex flex-wrap gap-1">
                  {FILTERS.map((f) => (
                    <Button
                      key={f}
                      type="button"
                      size="sm"
                      variant={filter === f ? "default" : "outline"}
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                    >
                      {f === "all" ? "All" : TEMPLATES[f].label}
                      <span className="ml-1 font-mono text-xs opacity-80">{counts[f]}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <ResortChip isStale={isStale} onResort={resort} what="Numbers" />
              {ordered.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-sub">
                  No {filter === "all" ? "" : `${TEMPLATES[filter].label} `}records yet.
                </p>
              ) : (
                <ul className="space-y-2" aria-label="Decision records">
                  {ordered.map((d) => (
                    <DecisionCard
                      key={d.id}
                      decision={d}
                      all={records}
                      today={today}
                      roster={roster}
                      expanded={open.has(d.id)}
                      onToggle={() => toggle(d.id)}
                      onJump={jump}
                      onChange={change}
                      onDelete={remove}
                    />
                  ))}
                </ul>
              )}

              <AdvancedAnalysis summary="How long decisions take">
                {speed ? (
                  <p className="flex items-start gap-2 text-sm text-text">
                    <Timer className="mt-0.5 h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
                    <span>
                      Median time from raised to decided:{" "}
                      <span className="font-mono font-semibold">
                        {speed.medianDays === 1 ? "1 day" : `${speed.medianDays} days`}
                      </span>
                      , over {speed.n} decided records.
                    </span>
                  </p>
                ) : (
                  <NotEnoughData
                    have={decidedWithDays}
                    need="average"
                    unit={["decided record", "decided records"]}
                    action="Decide"
                    what="how long decisions take"
                  />
                )}
                <p className="text-xs text-sub">
                  Counted from the day a record was raised to the day it was decided.
                </p>
              </AdvancedAnalysis>
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
