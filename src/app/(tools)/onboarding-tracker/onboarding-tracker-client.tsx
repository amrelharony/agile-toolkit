"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clock, TrendingUp, UserPlus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResetButton } from "@/components/shared/reset-button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { usePersisted } from "@/lib/utils/use-persisted";
import { removeWithUndo } from "@/lib/utils/undoable";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ONBOARDING_TRACKER_ACTIONS } from "@/lib/history/event-actions";
import { generateOnboardingTrackerPrompts } from "@/lib/ai-prompts/onboarding-tracker";
import { todayIso } from "@/lib/sprints/series";
import { addToRoster, findRosterMember, useTeamRoster } from "@/lib/team/use-team-roster";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { buildExample } from "./example";
import { markStatText, onboardingToMarkdown, rampText } from "./markdown";
import {
  STORAGE_KEY,
  TEMPLATES_KEY,
  daysToComplete,
  memberFor,
  milestonesFrom,
  normalizeOnboardees,
  normalizeTemplates,
  onboardingStats,
  onboardingVerdict,
  rampCurve,
  templatesOf,
  withRosterNames,
  type MarkStat,
  type Milestone,
  type MilestoneTemplate,
  type Onboardee,
} from "./model";
import { PersonCard } from "./person-card";
import { PersonForm, type PersonValues } from "./person-form";
import { TemplateSection } from "./template-section";

// Recharts loads with the ramp curve, not the page.
const RampCurveChart = dynamic(() => import("./charts").then((m) => m.RampCurveChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

type ListUpdate<T> = (list: readonly T[]) => T[];

const noLog = () => undefined;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** An average KPI's value: the mean once MIN_SAMPLE.average people reached it. */
const avgValue = (s: MarkStat) => (s.avg !== null ? `${s.avg.toFixed(1)}d` : "—");
const avgHint = (s: MarkStat) =>
  s.avg !== null
    ? `${s.n} people`
    : s.n === 0
      ? "no one yet"
      : `${s.n} of ${MIN_SAMPLE.average} needed`;

/**
 * Onboarding Speed Tracker: each new joiner's milestones from an editable
 * template, ticked as they're reached (and backdated to when), with the
 * time to a first PR and to productivity, and a ramp curve that counts each
 * day only for the people who have reached it.
 */
export function OnboardingTrackerClient() {
  const [stored, setStored] = usePersisted<unknown>(STORAGE_KEY, []);
  const [storedTemplates, setStoredTemplates] = usePersisted<unknown>(TEMPLATES_KEY, null);
  const { log } = useHistoryLogger("onboarding-tracker");
  const roster = useTeamRoster();
  const announce = useAnnounce();
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

  // Today, re-read every minute so a page left open over midnight moves on.
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const i = setInterval(() => setToday(todayIso()), 60_000);
    return () => clearInterval(i);
  }, []);

  // The example lives here only: nothing in it reaches the saved people,
  // nor the saved template (it gets a copy to try edits on).
  const [example, setExample] = useState<Onboardee[] | null>(null);
  const [exampleTemplates, setExampleTemplates] = useState<MilestoneTemplate[] | null>(null);
  const preview = example !== null;
  // Names as the roster has them now (a rename on the Team page shows).
  const onboardees = useMemo(
    () => (example ?? normalizeOnboardees(stored)).map((p) => withRosterNames(p, roster)),
    [example, stored, roster]
  );
  const templates = useMemo(
    () => (preview && exampleTemplates ? exampleTemplates : templatesOf(storedTemplates)),
    [preview, exampleTemplates, storedTemplates]
  );
  const customTemplates = !preview && normalizeTemplates(storedTemplates) !== null;
  // Fixed for the render an edit starts in, so its Undo goes back to the same place.
  const writePeople = preview
    ? (fn: ListUpdate<Onboardee>) => setExample((ex) => ex && fn(ex))
    : (fn: ListUpdate<Onboardee>) => setStored((prev: unknown) => fn(normalizeOnboardees(prev)));
  const record: typeof log = preview ? noLog : log;
  const writeTemplates = preview
    ? (fn: ListUpdate<MilestoneTemplate>) => setExampleTemplates((t) => t && fn(t))
    : (fn: ListUpdate<MilestoneTemplate>) =>
        setStoredTemplates((prev: unknown) => fn(templatesOf(prev)));

  /* ── Changes ──────────────────────────────────────────────────────── */

  const addOnboardee = (values: PersonValues) => {
    const member = findRosterMember(roster, values.name);
    const buddy = values.buddy ? findRosterMember(roster, values.buddy) : undefined;
    const person: Onboardee = {
      id: crypto.randomUUID(),
      name: member?.name ?? values.name,
      ...(member ? { memberId: member.id } : {}),
      ...(values.role ? { role: values.role } : {}),
      ...(values.buddy ? { buddy: buddy?.name ?? values.buddy } : {}),
      ...(buddy ? { buddyMemberId: buddy.id } : {}),
      startDate: values.startDate,
      milestones: milestonesFrom(templates, () => crypto.randomUUID()),
      ...(values.description ? { description: values.description } : {}),
    };
    writePeople((prev) => [person, ...prev]);
    record(ONBOARDING_TRACKER_ACTIONS.PERSON_ADDED, {
      personId: person.id,
      name: person.name,
      role: person.role,
    });
    announce(`Added ${person.name}`);
  };

  const patchPerson = (personId: string, fn: (p: Onboardee) => Onboardee) =>
    writePeople((prev) => prev.map((p) => (p.id === personId ? fn(p) : p)));

  const saveDetails = (person: Onboardee, values: PersonValues) => {
    const member = findRosterMember(roster, values.name);
    const buddy = values.buddy ? findRosterMember(roster, values.buddy) : undefined;
    patchPerson(person.id, (p) => ({
      ...p,
      name: member?.name ?? values.name,
      memberId: member?.id,
      role: values.role,
      buddy: values.buddy ? (buddy?.name ?? values.buddy) : undefined,
      buddyMemberId: buddy?.id,
      startDate: values.startDate,
      description: values.description,
    }));
    announce(`Saved ${values.name}`);
  };

  const removePerson = (person: Onboardee) => {
    removeWithUndo<Onboardee>({
      label: `Removed ${person.name}`,
      update: writePeople,
      match: (p) => p.id === person.id,
    });
    record(ONBOARDING_TRACKER_ACTIONS.PERSON_REMOVED, { personId: person.id, name: person.name });
    announce(`Removed ${person.name}`);
  };

  const patchMilestone = (person: Onboardee, milestoneId: string, patch: Partial<Milestone>) =>
    patchPerson(person.id, (p) => ({
      ...p,
      milestones: p.milestones.map((m) => (m.id === milestoneId ? { ...m, ...patch } : m)),
    }));

  const toggleMilestone = (person: Onboardee, milestone: Milestone) => {
    const wasCompleted = Boolean(milestone.completedAt);
    // Ticking says "reached today"; the date beside it backdates it.
    const completedAt = wasCompleted ? undefined : today;
    patchMilestone(person, milestone.id, { completedAt });
    if (!wasCompleted) {
      record(ONBOARDING_TRACKER_ACTIONS.MILESTONE_LOGGED, {
        personId: person.id,
        milestoneId: milestone.id,
        milestoneName: milestone.name,
        completedAt,
      });
      announce(`${milestone.name} reached for ${person.name}`);
    } else {
      // Un-ticking is logged too, so the history shows the rollback.
      record(ONBOARDING_TRACKER_ACTIONS.MILESTONE_UNCOMPLETED, {
        personId: person.id,
        milestoneId: milestone.id,
        milestoneName: milestone.name,
      });
      announce(`${milestone.name} not reached for ${person.name}`);
    }
  };

  const linkToRoster = (person: Onboardee) => {
    // Someone already linked (by id, or a name the roster has) is never
    // added a second time under an old name.
    const member = memberFor(roster, person.memberId, person.name) ?? addToRoster(person.name);
    patchPerson(person.id, (p) => ({ ...p, name: member.name, memberId: member.id }));
    announce(`Added ${member.name} to the team`);
  };

  const loadExample = () => {
    setExample(buildExample(today));
    setExampleTemplates([...templates]);
    announce("Loaded an example");
  };
  const clearExample = () => {
    setExample(null);
    setExampleTemplates(null);
  };

  // Clear all: the people go (the template stays); Undo puts them back.
  const resetSnapshot = useRef<unknown>(null);
  const reset = () => {
    resetSnapshot.current = stored;
    setStored([]);
    log(ONBOARDING_TRACKER_ACTIONS.ONBOARDING_RESET, { people: onboardees.length });
  };
  const undoReset = () => setStored(resetSnapshot.current ?? []);

  const templateSnapshot = useRef<unknown>(null);
  const restoreBuiltIns = () => {
    templateSnapshot.current = storedTemplates;
    setStoredTemplates(null);
  };
  const undoRestoreBuiltIns = () => setStoredTemplates(templateSnapshot.current);

  /* ── Numbers ──────────────────────────────────────────────────────── */

  const stats = useMemo(() => onboardingStats(onboardees, today), [onboardees, today]);
  const verdict = onboardingVerdict(onboardees, today);
  const ramp = useMemo(() => rampCurve(onboardees, today), [onboardees, today]);
  const rampChart = rampText(ramp);
  const rampHasPoint = ramp.some((p) => p.avgPct !== null);
  const mostReached = ramp.reduce((max, p) => Math.max(max, p.reached), 0);
  const markdown = onboardingToMarkdown(onboardees, today);

  const promptConfig = useMemo(
    () => ({
      toolName: "Onboarding Speed Tracker",
      prompts: generateOnboardingTrackerPrompts(
        {
          onboardees: onboardees.map((p) => ({
            name: p.name,
            role: p.role,
            startDate: p.startDate,
            description: p.description,
            milestones: p.milestones.map((m) => ({
              name: m.name,
              targetDays: m.targetDays,
              completedAt: m.completedAt,
              notes: m.notes,
            })),
          })),
          // The page's averages: null until MIN_SAMPLE.average people.
          avgTimeToFirstPR: stats.firstPr.avg,
          avgTimeToProductivity: stats.productive.avg,
          // The prompt's own at-risk table includes overdue milestones, so
          // its headline count does too.
          atRiskCount: stats.atRisk + stats.overdue,
        },
        workspace
      ),
    }),
    [onboardees, stats, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="onboarding-tracker"
      title="Onboarding Speed Tracker"
      description="Track milestones, time-to-first-PR, and time-to-productivity for each new hire's ramp."
      category="Team Health & Maturity"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="onboarding-tracker"
          markdown={markdown}
          csvData={{
            headers: [
              "Name",
              "Role",
              "Buddy",
              "Start date",
              "Description",
              "Milestone",
              "Target days",
              "Completed at",
              "Days to complete",
              "Notes",
            ],
            rows: onboardees.flatMap((p) =>
              p.milestones.map((m) => [
                p.name,
                p.role ?? "",
                p.buddy ?? "",
                p.startDate,
                p.description ?? "",
                m.name,
                m.targetDays,
                m.completedAt ?? "",
                daysToComplete(p, m) ?? "",
                m.notes ?? "",
              ])
            ),
          }}
          jsonData={onboardees}
        />
        <ResetButton
          label="Clear all"
          title="Remove every new joiner?"
          description={`${onboardees.length === 1 ? "1 person" : `${onboardees.length} people`} and their milestones. The milestone template stays.`}
          confirmLabel="Remove everyone"
          doneLabel="Removed every new joiner"
          onReset={reset}
          onUndo={undoReset}
          disabled={preview || onboardees.length === 0}
        />
      </ActionRow>

      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: four new joiners at day 5, 20, 45 and 95. Nothing in it is saved, and your own
            people and milestone template stay as they are.
          </p>
        </div>
      )}

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={UserPlus}
          label="Active onboardees"
          value={stats.active}
          hint={stats.finished > 0 ? `${stats.finished} finished` : undefined}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Avg time-to-first-PR"
          value={avgValue(stats.firstPr)}
          hint={avgHint(stats.firstPr)}
        />
        <StatCard
          variant="compact"
          icon={TrendingUp}
          label="Avg time-to-productivity"
          value={avgValue(stats.productive)}
          hint={avgHint(stats.productive)}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Overdue / at-risk milestones"
          value={`${stats.overdue} / ${stats.atRisk}`}
          hint="past target / over half its time used"
          tone={stats.overdue > 0 ? "danger" : stats.atRisk > 0 ? "warning" : "default"}
        />
      </KpiGrid>

      {onboardees.length > 0 && <p className="mb-4 text-sm font-medium text-text">{verdict}</p>}

      {(stats.overdue > 0 || stats.atRisk > 0) && (
        <CalloutAlert tone={stats.overdue > 0 ? "danger" : "warning"} className="mb-4">
          {stats.overdue > 0 && (
            <>
              <strong>{stats.overdue}</strong>{" "}
              {plural(stats.overdue, "milestone is", "milestones are")} overdue: past the target day
              without completion.{" "}
            </>
          )}
          {stats.atRisk > 0 && (
            <>
              <strong>{stats.atRisk}</strong>{" "}
              {plural(stats.atRisk, "milestone is", "milestones are")} at risk: more than half the
              target time has passed without completion.{" "}
            </>
          )}
          Consider a check-in.
        </CalloutAlert>
      )}

      <SectionCard title="Add a new joiner" icon={UserPlus} className="mb-4">
        <PersonForm
          initial={{ name: "", role: "", buddy: "", startDate: today, description: "" }}
          submitLabel="Add onboardee"
          onSave={addOnboardee}
          offerAddToRoster={!preview}
        />
        <p className="mt-2 text-xs text-sub">
          They start with the {templates.length} milestones of the template below.
        </p>
      </SectionCard>

      {onboardees.length === 0 ? (
        <EmptyState icon={UserPlus} action={<LoadExampleButton onLoad={loadExample} />}>
          No onboardees yet. Add your first new joiner above to start tracking their ramp.
        </EmptyState>
      ) : (
        <div className="space-y-3 mb-6">
          {onboardees.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              today={today}
              onRoster={Boolean(memberFor(roster, p.memberId, p.name))}
              offerAddToRoster={!preview}
              onToggle={(m) => toggleMilestone(p, m)}
              onPatchMilestone={(m, patch) => patchMilestone(p, m.id, patch)}
              onSaveDetails={(values) => saveDetails(p, values)}
              onAddToRoster={() => linkToRoster(p)}
              onRemove={() => removePerson(p)}
            />
          ))}
        </div>
      )}

      {onboardees.length > 0 && (
        <SectionCard
          title="Ramp curve (milestones reached over time)"
          icon={TrendingUp}
          className="mb-4"
        >
          {rampHasPoint ? (
            <ChartFigure
              label="Ramp curve"
              summary={rampChart.summary}
              table={rampChart.table}
              caption="Average milestones reached by day"
              plotClassName="h-64 -mx-2"
            >
              <RampCurveChart data={ramp} />
            </ChartFigure>
          ) : (
            <NotEnoughData
              have={mostReached}
              need="average"
              unit={["new joiner", "new joiners"]}
              what="the ramp curve (each day counts the people who have reached it)"
            />
          )}
          <p className="mt-3 text-xs text-sub">
            Time to first PR: {markStatText(stats.firstPr)}. Time to productivity:{" "}
            {markStatText(stats.productive)}.
          </p>
        </SectionCard>
      )}

      <TemplateSection
        templates={templates}
        custom={customTemplates}
        note={
          preview
            ? "While the example is shown, edits here change the example's copy of the template, not yours."
            : undefined
        }
        onChange={writeTemplates}
        onRestoreBuiltIns={restoreBuiltIns}
        onRestoreUndo={undoRestoreBuiltIns}
      />
    </ToolPageWrapper>
  );
}
