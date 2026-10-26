"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { AlertTriangle, GitCompare, Heart, ListChecks, Radio, Users, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { generatePsychSafetyPrompts } from "@/lib/ai-prompts/psych-safety";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PsychSafetyLog, PsychSafetyRound, Workspace } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PSYCH_SAFETY_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { todayIso } from "@/lib/sprints/series";
import { fmt } from "@/lib/charts/chart-text";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import {
  ANOMALY_DROP,
  LEGACY_ROUND_ID,
  PSYCH_SAFETY_ID,
  PSYCH_SAFETY_MIN_RESPONSES,
  PSYCH_SAFETY_QUESTIONS,
  ROUND_NAME_MAX,
  compareRounds,
  countsFromVoteResult,
  coveredLabel,
  defaultRoundName,
  emptyPsychSafetyLog,
  psychSafetyQuestionnaire,
  questionLabel,
  questionMeta,
  roundDateProblem,
  roundResult,
  roundsOf,
  shownCounts,
  withRound,
  withRoundPatch,
} from "@/lib/psych-safety/instrument";
import { DayField } from "../health-check/day-field";
import { neighbourKeys, useFocusAfter } from "../health-check/use-focus-after";
import { useToday } from "../health-check/use-today";
import { radarText } from "./chart-text";
import { validateRoundDetails, type RoundDetails } from "./details";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { PsychSafetyRadar } from "./radar";
import { RoundList } from "./rounds";
import { anomalyTopic, psychSafetyVerdict } from "./verdict";

const QUESTIONNAIRE = psychSafetyQuestionnaire();

function peekLog(): PsychSafetyLog | null {
  return (
    (useWorkspaceStore.getState().psychSafetyLogs ?? []).find((d) => d.id === PSYCH_SAFETY_ID) ??
    null
  );
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n), 2)}`;

/**
 * Psychological Safety: Edmondson's seven statements, answered in
 * anonymous rounds (a live round on people's phones, or counts from paper)
 * and kept only as counts per statement. A round's results show from five
 * responses; two rounds compare statement by statement, and a statement
 * whose score falls by more than half a point is flagged. The example is a
 * read-only preview.
 */
export function PsychSafetyClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore(
    useShallow((s) => (s.psychSafetyLogs ?? []).find((d) => d.id === PSYCH_SAFETY_ID))
  );
  const [example, setExample] = useState<PsychSafetyLog | null>(null);
  const preview = example !== null;
  const log = example ?? stored ?? null;
  const rounds = useMemo(() => roundsOf(log), [log]);
  const { sprints } = useSelectedSprint();
  const { log: logEvent } = useHistoryLogger("psych-safety");
  const announce = useAnnounce();
  const today = useToday();
  const [details, setDetails] = useState<RoundDetails>({ name: "", date: today });
  const detailsRef = useRef(details);
  detailsRef.current = details;
  // A round dated today stays today's past midnight; a day picked by hand stays.
  const wasToday = useRef(today);
  useEffect(() => {
    const before = wasToday.current;
    wasToday.current = today;
    if (before !== today) setDetails((x) => (x.date === before ? { ...x, date: today } : x));
  }, [today]);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfter = useFocusAfter(rootRef);
  const [shownId, setShownId] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const resultsTitleId = useId();
  const roundSelectId = useId();
  const fromSelectId = useId();
  const toSelectId = useId();

  const latest = rounds[rounds.length - 1] ?? null;
  const shown = rounds.find((r) => r.id === shownId) ?? latest;
  const shownAt = shown ? rounds.indexOf(shown) : -1;
  const before = shownAt > 0 ? rounds[shownAt - 1] : null;
  const result = roundResult(shown);
  const beforeResult = roundResult(before);
  const shownCmp = compareRounds(before, shown);

  const to = rounds.find((r) => r.id === toId) ?? latest;
  const from =
    rounds.find((r) => r.id === fromId) ?? (to ? (rounds[rounds.indexOf(to) - 1] ?? null) : null);
  const cmp = from && to && from.id !== to.id ? compareRounds(from, to) : null;

  const verdict = psychSafetyVerdict(rounds);

  /* ── Writes ─────────────────────────────────────────────────────────── */

  const write = (fn: (l: PsychSafetyLog) => PsychSafetyLog | null): boolean => {
    if (preview) return false;
    const next = fn(peekLog() ?? emptyPsychSafetyLog());
    if (!next) return false;
    useWorkspaceStore.getState().upsertPsychSafetyLog(next);
    return true;
  };

  const saveRound = (vote: VoteRoundResult) => {
    const checked = validateRoundDetails(detailsRef.current, { today: todayIso(), log: peekLog() });
    if (!checked.ok) {
      // The day field only passes a valid day on, so this is a clock that moved
      // back. False keeps the kit's Save round available for after the fix.
      const problem = checked.errors.date ?? checked.errors.name ?? "Check the round's details.";
      toast.error(`${problem} Nothing was saved.`);
      return false;
    }
    const d = checked.values;
    const round: PsychSafetyRound = {
      id: `psRound_${nanoid(8)}`,
      name: d.name,
      date: d.date,
      ...(d.sprintId ? { sprintId: d.sprintId } : {}),
      source: vote.source === "live" ? "room" : "facilitator",
      responses: vote.ballots,
      counts: countsFromVoteResult(vote),
      createdAt: new Date().toISOString(),
    };
    if (!write((l) => withRound(l, round))) return false;
    // Counts only: never who answered, or what.
    logEvent(PSYCH_SAFETY_ACTIONS.ASSESSMENT_SAVED, {
      roundId: round.id,
      responses: round.responses,
    });
    // The next round is likely another sprint's: its name and sprint start blank again.
    setDetails((x) => ({ name: "", date: x.date }));
    setShownId(round.id);
    setToId(null);
    setFromId(null);
    announce(`Saved ${round.name}: ${round.responses} responses`);
    return () => {
      write((l) => ({ ...l, rounds: (l.rounds ?? []).filter((r) => r.id !== round.id) }));
    };
  };

  const remove = (r: PsychSafetyRound) => {
    // The list is newest first: the next row down, else the one above, else the round name.
    focusAfter(
      ...neighbourKeys(
        [...rounds].reverse().map((x) => x.id),
        r.id,
        "delete:"
      ),
      "round-name"
    );
    if (r.id === LEGACY_ROUND_ID) {
      const sheets = peekLog()?.responses ?? [];
      undoable({
        label: `Deleted ${r.name}`,
        description: `${sheets.length} answer ${sheets.length === 1 ? "sheet" : "sheets"} from before rounds.`,
        apply: () => {
          write((l) => ({ ...l, responses: [] }));
        },
        revert: () => {
          write((l) => ({ ...l, responses: [...sheets, ...(l.responses ?? [])] }));
        },
      });
    } else {
      removeWithUndo<PsychSafetyRound>({
        label: `Deleted ${r.name}`,
        update: (fn) => {
          write((l) => ({ ...l, rounds: fn(l.rounds ?? []) }));
        },
        match: (x) => x.id === r.id,
      });
    }
    logEvent(PSYCH_SAFETY_ACTIONS.ROUND_REMOVED, { roundId: r.id });
    if (shownId === r.id) setShownId(null);
    announce(`Deleted ${r.name}`);
  };

  /* ── Exports and prompts ────────────────────────────────────────────── */

  const markdown = useMemo(
    () => toMarkdown(rounds, { verdict, shown, compared: before }),
    [rounds, verdict, shown, before]
  );
  const csvData = useMemo(
    () => ({
      headers: [
        "Round",
        "Date",
        "Responses",
        "Statement",
        "Reverse-scored",
        "Answered 1",
        "Answered 2",
        "Answered 3",
        "Answered 4",
        "Answered 5",
        "Score",
      ],
      rows: rounds.flatMap((r) => {
        const res = roundResult(r);
        return PSYCH_SAFETY_QUESTIONS.map((q) => {
          // Withheld as on the page: a thin round's counts would show what a person answered.
          const c = shownCounts(r, q.id) ?? ["—", "—", "—", "—", "—"];
          const score = res?.perQuestion.find((x) => x.id === q.id)?.adjusted ?? null;
          return [
            r.name,
            r.date,
            r.responses,
            `${questionLabel(q.id)}. ${q.text}`,
            q.reversed ? "yes" : "no",
            ...c,
            score === null ? "—" : Math.round(score * 100) / 100,
          ];
        });
      }),
    }),
    [rounds]
  );

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );
  // The shown round's aggregates only (its results and the change since the
  // round before), never an answer per person.
  const promptConfig = useMemo(
    () => ({
      toolName: "Psychological Safety Assessment",
      prompts: generatePsychSafetyPrompts(
        {
          roundName: shown?.name ?? "",
          result,
          previousName: before?.name,
          comparison: shownCmp,
        },
        workspace
      ),
    }),
    [shown, result, before, shownCmp, workspace]
  );

  const title = "Psychological Safety Assessment";
  const description =
    "Edmondson's seven statements in anonymous rounds: a team score from five responses, and how it moves between rounds.";

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId="psych-safety"
        title={title}
        description={description}
        category="Team Health & Maturity"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the survey…
        </p>
      </ToolPageWrapper>
    );
  }

  const lowest = result?.lowest ? result.perQuestion.find((q) => q.id === result.lowest) : null;

  return (
    <ToolPageWrapper
      toolId="psych-safety"
      title={title}
      description={description}
      category="Team Health & Maturity"
    >
      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: a product team&apos;s two rounds, the second after an incident. It&apos;s a
            read-only preview: nothing is saved.
          </p>
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="psych-safety" csvData={csvData} markdown={markdown} />
      </ActionRow>

      <p className="mb-4 text-sm font-medium text-text" data-testid="psych-safety-verdict">
        {verdict}
      </p>

      <div ref={rootRef} className="space-y-6">
        <SectionCard title="Run a round" icon={Radio} contentClassName="space-y-4">
          {preview ? (
            <p className="text-sm text-sub">Clear the example to run a round with your team.</p>
          ) : (
            <>
              <p className="text-sm text-sub">
                Everyone answers the seven statements on their own, anonymously. Only how many chose
                each answer is kept, and the results show from {PSYCH_SAFETY_MIN_RESPONSES}{" "}
                responses, so no one&apos;s answers can be singled out.
              </p>
              <div className="flex flex-wrap items-end gap-4" data-focus-key="round-name">
                <Field
                  label="Round name"
                  hint={`Leave blank to call it ${defaultRoundName(log)}.`}
                  className="min-w-0 max-w-xs flex-1"
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={details.name}
                      maxLength={ROUND_NAME_MAX}
                      placeholder={defaultRoundName(log)}
                      onChange={(e) => setDetails((x) => ({ ...x, name: e.target.value }))}
                    />
                  )}
                </Field>
                <DayField
                  label="Taken on"
                  value={details.date}
                  max={today}
                  problem={(day) => roundDateProblem(day, today)}
                  onChange={(day) => setDetails((x) => ({ ...x, date: day }))}
                />
                {sprints.length > 0 && (
                  <div className="flex flex-wrap items-end gap-2" data-focus-key="sprint">
                    <SprintPicker
                      sprints={sprints}
                      // "" rather than undefined keeps the picker controlled, so after
                      // "No sprint" it shows none and the same sprint can be picked again.
                      selectedId={details.sprintId ?? ""}
                      onSelect={(id) => setDetails((x) => ({ ...x, sprintId: id || undefined }))}
                      label="Sprint (optional)"
                      allowCreate={false}
                    />
                    {details.sprintId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => {
                          // The button goes with the sprint: focus moves to the picker.
                          focusAfter("sprint");
                          setDetails((x) => ({ name: x.name, date: x.date }));
                        }}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        No sprint
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <VoteRoundPanel
                tool="psych-safety"
                toolName="Psych Safety"
                questionnaire={QUESTIONNAIRE}
                minN={PSYCH_SAFETY_MIN_RESPONSES}
                onSave={saveRound}
              />
            </>
          )}
        </SectionCard>

        {rounds.length === 0 ? (
          <EmptyState
            icon={Heart}
            action={
              <LoadExampleButton onLoad={() => setExample(buildExample())} className="mt-4" />
            }
          >
            No rounds yet. Run one above: a live round on people&apos;s phones, or the counts from
            paper answers.
          </EmptyState>
        ) : (
          <>
            <SectionCard
              title={<span id={resultsTitleId}>Results</span>}
              icon={Heart}
              titleSize="lg"
              contentClassName="space-y-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={roundSelectId} className="text-xs font-medium text-sub">
                  Round
                </label>
                <select
                  id={roundSelectId}
                  value={shown?.id ?? ""}
                  onChange={(e) => setShownId(e.target.value)}
                  className="flex h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-sm"
                >
                  {[...rounds].reverse().map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.date}
                    </option>
                  ))}
                </select>
              </div>

              <KpiGrid cols={4} gap="lg">
                <StatCard
                  variant="compact"
                  icon={Heart}
                  label="Team score"
                  value={result?.teamScore != null ? fmt(result.teamScore, 2) : "—"}
                  unit={result?.teamScore != null ? "/5" : undefined}
                  hint={
                    coveredLabel(result)
                      ? `Over ${coveredLabel(result)}; higher is safer`
                      : "Higher is safer"
                  }
                  valueClassName="text-accent"
                />
                <StatCard
                  variant="compact"
                  icon={Users}
                  label="Responses"
                  value={shown?.responses ?? "—"}
                />
                <StatCard
                  variant="compact"
                  label="Lowest statement"
                  value={lowest ? questionLabel(lowest.id) : "—"}
                  hint={lowest?.adjusted != null ? `${fmt(lowest.adjusted, 2)}/5` : undefined}
                />
                <StatCard
                  variant="compact"
                  icon={AlertTriangle}
                  label={before ? `Change since ${before.name}` : "Change"}
                  value={shownCmp?.delta != null ? signed(shownCmp.delta) : "—"}
                  hint={
                    !before
                      ? "First round"
                      : shownCmp && shownCmp.common.length < PSYCH_SAFETY_QUESTIONS.length
                        ? `Over the ${shownCmp.common.length} statements both show`
                        : undefined
                  }
                  tone={shownCmp?.anomaly ? "danger" : "default"}
                />
              </KpiGrid>

              {!result ? (
                <NotEnoughData
                  have={shown?.responses ?? 0}
                  need={PSYCH_SAFETY_MIN_RESPONSES}
                  unit={["response", "responses"]}
                  action="That round needed"
                  what="its results"
                />
              ) : (
                <>
                  {shownCmp?.anomaly && before && shown && (
                    <CalloutAlert tone="danger">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0">
                          <strong>
                            {shownCmp.dropped.length === 1
                              ? "One statement fell"
                              : `${shownCmp.dropped.length} statements fell`}{" "}
                            by more than {ANOMALY_DROP} since {before.name}:
                          </strong>{" "}
                          {shownCmp.dropped.map((id) => `“${questionMeta(id)?.text}”`).join(", ")}.
                          Worth talking through at the retro, without asking who answered what.
                        </span>
                        {/* Team level only: the topic names the statements, never a person. */}
                        <SendToMenu
                          routes={["retro-topic"]}
                          item={{
                            title: anomalyTopic(shown, before, shownCmp.dropped),
                            tone: "concern",
                            sourceRef: { tool: "psych-safety", id: shown.id, doc: PSYCH_SAFETY_ID },
                          }}
                          sentTo={preview ? undefined : shown.sentTo}
                          getLinks={() =>
                            (peekLog()?.rounds ?? []).find((r) => r.id === shown.id)?.sentTo
                          }
                          // The legacy round is read-only: nowhere to keep its links.
                          disabled={preview || shown.source === "legacy"}
                          onLinksChange={(update) => {
                            write((l) => {
                              const fresh = (l.rounds ?? []).find((r) => r.id === shown.id);
                              return withRoundPatch(l, shown.id, { sentTo: update(fresh?.sentTo) });
                            });
                          }}
                          itemLabels={{ "retro-topic": "Retro topic (no names)" }}
                        />
                      </div>
                    </CalloutAlert>
                  )}
                  {result.withheld.length === 0 ? (
                    <ChartFigure
                      labelledBy={resultsTitleId}
                      {...radarText(result, shown?.name ?? "", beforeResult, before?.name ?? null)}
                    >
                      <PsychSafetyRadar cur={result.perQuestion} prev={beforeResult?.perQuestion} />
                    </ChartFigure>
                  ) : (
                    <p className="text-sm text-sub">
                      {result.withheld.map(questionLabel).join(", ")} had fewer than{" "}
                      {PSYCH_SAFETY_MIN_RESPONSES} answers, so{" "}
                      {result.withheld.length === 1 ? "it is" : "they are"} withheld.
                    </p>
                  )}
                  <ul className="space-y-2" aria-label="Score per statement">
                    {result.perQuestion.map((q) => (
                      <li key={q.id} className="text-xs">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="break-words text-text">
                            <span className="mr-1 text-sub">{questionLabel(q.id)}.</span>
                            {q.text}
                            {q.reversed && (
                              <span className="ml-2 text-xs text-warning">reverse-scored</span>
                            )}
                          </span>
                          <span className="shrink-0 font-data text-accent">
                            {q.adjusted === null ? "Withheld" : fmt(q.adjusted, 2)}
                          </span>
                        </div>
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-card-hover"
                          aria-hidden="true"
                        >
                          {q.adjusted !== null && (
                            <div
                              className="h-full bg-accent"
                              style={{ width: `${((q.adjusted - 1) / 4) * 100}%` }}
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>

            {rounds.length >= 2 && (
              <SectionCard title="Compare rounds" icon={GitCompare} contentClassName="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  {[
                    { id: fromSelectId, label: "From", value: from?.id, set: setFromId },
                    { id: toSelectId, label: "To", value: to?.id, set: setToId },
                  ].map((s) => (
                    <div key={s.label} className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={s.id} className="text-xs font-medium text-sub">
                        {s.label}
                      </label>
                      <select
                        id={s.id}
                        value={s.value ?? ""}
                        onChange={(e) => s.set(e.target.value)}
                        className="flex h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* "To" on the first round leaves no round before it: say so, not a blank box. */}
                        {!s.value && (
                          <option value="" disabled>
                            Pick a round
                          </option>
                        )}
                        {rounds.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.date}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {!cmp ? (
                  <p
                    className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub"
                    role="status"
                  >
                    {!from || !to
                      ? "Pick a round to compare from."
                      : from.id === to.id
                        ? "Pick two different rounds."
                        : `Both rounds need ${PSYCH_SAFETY_MIN_RESPONSES} responses to compare: a change between thinner rounds is noise.`}
                  </p>
                ) : (
                  <>
                    {cmp.anomaly ? (
                      <CalloutAlert tone="danger">
                        <strong>Fell by more than {ANOMALY_DROP}:</strong>{" "}
                        {cmp.dropped.map((id) => questionLabel(id)).join(", ")}.
                      </CalloutAlert>
                    ) : (
                      <p className="text-sm text-sub">
                        No statement fell by more than {ANOMALY_DROP}.
                      </p>
                    )}
                    {/* relative: a containing block, so the sr-only caption can't widen the page. */}
                    <div className="relative overflow-x-auto">
                      <table className="w-full min-w-[20rem] text-sm">
                        <caption className="sr-only">
                          Score per statement, {from?.name} to {to?.name}
                        </caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs text-sub">
                            <th scope="col" className="py-1 pr-3 font-medium">
                              Statement
                            </th>
                            <th scope="col" className="py-1 pr-3 text-right font-medium">
                              {from?.name}
                            </th>
                            <th scope="col" className="py-1 pr-3 text-right font-medium">
                              {to?.name}
                            </th>
                            <th scope="col" className="py-1 text-right font-medium">
                              Change
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {PSYCH_SAFETY_QUESTIONS.map((q) => {
                            const a =
                              roundResult(from)?.perQuestion.find((x) => x.id === q.id)?.adjusted ??
                              null;
                            const b =
                              roundResult(to)?.perQuestion.find((x) => x.id === q.id)?.adjusted ??
                              null;
                            const d = cmp.perQuestion.find((x) => x.id === q.id)?.delta ?? null;
                            return (
                              <tr key={q.id} className="border-b border-border last:border-0">
                                <th
                                  scope="row"
                                  className="py-1 pr-3 text-left font-normal text-text"
                                >
                                  {questionLabel(q.id)}
                                </th>
                                <td className="py-1 pr-3 text-right font-data">
                                  {a === null ? "—" : fmt(a, 2)}
                                </td>
                                <td className="py-1 pr-3 text-right font-data">
                                  {b === null ? "—" : fmt(b, 2)}
                                </td>
                                <td
                                  className={`py-1 text-right font-data ${d !== null && d < -ANOMALY_DROP ? "text-danger" : ""}`}
                                >
                                  {d === null ? "—" : signed(d)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </SectionCard>
            )}

            <SectionCard title="Rounds" icon={ListChecks} contentClassName="space-y-3">
              <RoundList
                rounds={rounds}
                sprints={sprints}
                today={today}
                readOnly={preview}
                onRename={(r, name) => {
                  const clean = name.trim();
                  if (!clean) return "Name the round.";
                  write((l) => withRoundPatch(l, r.id, { name: clean.slice(0, ROUND_NAME_MAX) }));
                  return null;
                }}
                onRedate={(r, date) => write((l) => withRoundPatch(l, r.id, { date }))}
                onRemove={remove}
              />
              {!preview && rounds.some((r) => r.source === "legacy") && (
                <p className="text-xs text-sub">
                  “Earlier responses” are the answer sheets this tool kept one by one before rounds.
                  They count only as totals now; delete the round to remove the sheets.
                </p>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
