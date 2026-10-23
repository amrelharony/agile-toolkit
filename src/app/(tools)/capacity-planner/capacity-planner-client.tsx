"use client";

import { useMemo, useRef, useState, type ElementType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarPlus,
  Clock,
  PieChart,
  Plus,
  RefreshCw,
  Settings2,
  Target,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { SmartInput } from "@/components/shared/smart-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateCapacityPrompts } from "@/lib/ai-prompts/capacity-planner";
import { bayesianForecastConfidence } from "@/lib/analytics/forecasting-bayesian";
import { hasRecentChangepoint } from "@/lib/analytics/changepoint";
import { enoughData } from "@/lib/analytics/min-sample";
import { CAPACITY_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CapacityMember,
  CapacityPlan,
  Sprint,
  TeamMember,
} from "@/lib/stores/workspace-types";
import {
  CAPACITY_PLAN_ID,
  capacityPlanIdFor,
  effectiveHours,
  planCapacity,
} from "@/lib/sprints/capacity";
import { averageVelocity, completedSprints } from "@/lib/sprints/hub-view";
import { velocity as velocityOf } from "@/lib/sprints/metrics";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { sprintHref, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import { buildExampleMembers } from "./example";
import { toMarkdown } from "./markdown";
import { MemberAddForm, MemberRow } from "./member-row";
import {
  MAX_SPRINT_DAYS,
  capacityVerdict,
  emptyPlan,
  fmt,
  forecastSentence,
  hoursBreakdown,
  isBlankMember,
  lastPlanFor,
  planFromSource,
  sprintLength,
  sprintLengthText,
  type SprintLength,
} from "./model";
import { NumberField } from "./number-field";
import { revertRosterSync, syncFromRoster, type RosterSyncResult } from "./roster-sync";

const TOOL_ID = "capacity-planner";
const NO_PLANS: CapacityPlan[] = [];

/* -------------------------------------------------------------------------- */
/*  Plan documents                                                            */
/* -------------------------------------------------------------------------- */

// One synced CapacityPlan document per sprint (`capacityPlanIdFor`), and the
// `capacity-planner:current` plan for a team with no sprints, which agents
// still write (tool.capacity_planner.*). Every write reads the stored
// document at that moment, so two tabs editing different rows don't clobber
// each other.

function readPlan(id: string): CapacityPlan | undefined {
  return (useWorkspaceStore.getState().capacityPlans ?? []).find((p) => p.id === id);
}

const savePlan = (plan: CapacityPlan) => useWorkspaceStore.getState().upsertCapacityPlan(plan);

/** `member` with `updates`, where an undefined value removes the field. */
function withUpdates(member: CapacityMember, updates: Partial<CapacityMember>): CapacityMember {
  const next = { ...member, ...updates };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete (next as Record<string, unknown>)[key];
  }
  return next;
}

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "Synced 3 people from the team", with what happened to which rows. */
function syncToastText({ added, changed }: RosterSyncResult): {
  label: string;
  description: string;
} {
  const n = added.length + changed.length;
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`${added.length} new ${added.length === 1 ? "row" : "rows"}`);
  }
  if (changed.length > 0) {
    parts.push(
      `${changed.length} existing ${changed.length === 1 ? "row" : "rows"} linked or renamed`
    );
  }
  return {
    label: `Synced ${n} ${n === 1 ? "person" : "people"} from the team`,
    description: `${parts.join(", ")}.`,
  };
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export function CapacityPlannerClient() {
  const hydrated = useWorkspaceHydrated();
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Sprint Capacity Planner"
      description="Calculate your team's effective sprint capacity based on availability, time off, ceremony overhead, and focus factor."
      category="Sprint Planning & Estimation"
    >
      {hydrated ? (
        <CapacityPlanner />
      ) : (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the capacity plan…
        </p>
      )}
    </ToolPageWrapper>
  );
}

/**
 * Which plan is on screen: the selected sprint's own plan (one per sprint,
 * so days off and holidays stay with their sprint), or the general plan when
 * the team has no sprints yet. A sprint without a plan asks how to start;
 * nothing is created until the user picks.
 */
function CapacityPlanner() {
  const { sprints, selected, select } = useSelectedSprint();
  const [cadence] = useCeremonyCadence();
  const plans = useWorkspaceStore((s) => s.capacityPlans) ?? NO_PLANS;
  const [creating, setCreating] = useState(false);

  const planId = capacityPlanIdFor(selected?.id);
  const stored = plans.find((p) => p.id === planId);
  const length = useMemo(() => sprintLength(selected, cadence), [selected, cadence]);
  const velocity = useMemo(
    () => averageVelocity(completedSprints(sprints), selected?.id),
    [sprints, selected?.id]
  );
  const general = plans.find((p) => p.id === CAPACITY_PLAN_ID);
  // Shown, not saved, until the first edit.
  const generalDefault = useMemo(
    () => emptyPlan(undefined, length.workingDays),
    [length.workingDays]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <SprintPicker
          sprints={[...sprints]}
          selectedId={selected?.id}
          onSelect={select}
          label="Plan for"
          allowCreate={false}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          New sprint
        </Button>
        <p className="min-w-0 basis-full text-xs text-sub sm:basis-auto sm:flex-1">
          {selected
            ? `One plan per sprint: Sprint Planning reads ${selected.name}'s plan for its forecast.`
            : "Your general plan, not tied to a sprint. Create a sprint to keep one plan per sprint."}
        </p>
      </div>

      {selected && !stored ? (
        <StartPlan
          sprint={selected}
          sprints={sprints}
          plans={plans}
          length={length}
          general={general}
        />
      ) : (
        <PlanEditor
          // A fresh editor per plan: drafts and the reset snapshot belong to one plan.
          key={planId}
          plan={stored ?? generalDefault}
          sprint={selected}
          sprints={sprints}
          length={length}
          velocity={velocity.average}
        />
      )}

      <NewSprintDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(sprint: Sprint) => select(sprint.id)}
        defaultName={nextSprintName(sprints)}
        defaultLengthDays={cadence.sprintLengthDays}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  A sprint with no plan yet                                                 */
/* -------------------------------------------------------------------------- */

function StartPlan({
  sprint,
  sprints,
  plans,
  length,
  general,
}: {
  sprint: Sprint;
  sprints: Sprint[];
  plans: CapacityPlan[];
  length: SprintLength;
  general: CapacityPlan | undefined;
}) {
  const { log } = useHistoryLogger(TOOL_ID);
  const source = useMemo(() => lastPlanFor(plans, sprints, sprint), [plans, sprints, sprint]);
  const generalHours =
    general && general.members.some((m) => !isBlankMember(m))
      ? planCapacity(general).totalHours
      : null;
  const days = `${length.workingDays} working ${length.workingDays === 1 ? "day" : "days"}`;

  const start = (plan: CapacityPlan, how: string) => {
    undoable({
      label: `Started ${sprint.name}'s capacity plan`,
      description: how,
      apply: () => {
        savePlan(plan);
        log(CAPACITY_ACTIONS.CONFIG_UPDATED, { sprintId: sprint.id, started: how });
      },
      revert: () => useWorkspaceStore.getState().removeCapacityPlan(plan.id),
    });
  };

  return (
    <EmptyState
      icon={CalendarPlus}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {source && (
            <Button
              type="button"
              onClick={() =>
                start(
                  planFromSource(source.plan, sprint.id, length.workingDays),
                  `Copied from ${source.label}`
                )
              }
            >
              Start from your last plan
            </Button>
          )}
          <Button
            type="button"
            variant={source ? "outline" : "default"}
            onClick={() => start(emptyPlan(sprint.id, length.workingDays), "Empty")}
          >
            Start empty
          </Button>
          {!source && (
            <LoadExampleButton
              onLoad={() =>
                savePlan({
                  ...emptyPlan(sprint.id, length.workingDays),
                  members: buildExampleMembers(),
                })
              }
            />
          )}
        </div>
      }
    >
      <h2 className="font-display text-lg font-semibold text-text">
        {sprint.name} has no capacity plan yet
      </h2>
      <p className="mx-auto mt-1 max-w-prose text-sm">
        {source
          ? `“Start from your last plan” copies ${source.label}: ${source.plan.members.filter((m) => !isBlankMember(m) && !isExampleId(m.id)).length} people, their availability and the settings. Days off start at 0, and the length comes from ${sprint.name} (${days}).`
          : `Add who's on the team, their availability and days off. The length comes from ${sprint.name} (${days}).`}
      </p>
      {generalHours !== null && (
        <p className="mx-auto mt-2 max-w-prose text-xs">
          Until then, Sprint Planning uses your general plan ({fmt(generalHours)} hours).
        </p>
      )}
    </EmptyState>
  );
}

/* -------------------------------------------------------------------------- */
/*  The plan                                                                  */
/* -------------------------------------------------------------------------- */

const CONFIDENCE_TONE: Record<"high" | "medium" | "low", string> = {
  high: "border-success/40 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-border bg-surface text-sub",
};

function SummaryCard({
  label,
  value,
  unit,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: ElementType;
}) {
  return (
    <Card className="border-border bg-surface">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-3">
          <div className="rounded-lg bg-accent/10 p-2">
            <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <span className="text-sm text-sub">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-data text-3xl font-bold text-text">{value}</span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanEditor({
  plan,
  sprint,
  sprints,
  length,
  velocity,
}: {
  /** The stored plan, or the general plan's unsaved default. */
  plan: CapacityPlan;
  sprint: Sprint | undefined;
  sprints: Sprint[];
  length: SprintLength;
  velocity: number | null;
}) {
  const { members, config } = plan;
  const { log } = useHistoryLogger(TOOL_ID);
  const roster = useTeamRoster();
  const exportRef = useRef<HTMLDivElement>(null);
  const resetSnapshot = useRef<CapacityPlan | null>(null);

  /** The plan as stored now; the unsaved default before the first edit. */
  const current = () => readPlan(plan.id) ?? plan;
  const write = (change: (p: CapacityPlan) => CapacityPlan) => savePlan(change(current()));

  const addMember = (values: Omit<CapacityMember, "id">) => {
    const member: CapacityMember = { id: crypto.randomUUID(), ...values };
    write((p) => ({ ...p, members: [...p.members, member] }));
    log(CAPACITY_ACTIONS.MEMBER_ADDED, { memberId: member.id, name: member.name });
  };

  /** Put a removed member back at their old position; a no-op if already back. */
  const restoreMember = (member: CapacityMember, index: number) =>
    write((p) => {
      if (p.members.some((m) => m.id === member.id)) return p;
      const next = [...p.members];
      next.splice(Math.min(index, next.length), 0, member);
      return { ...p, members: next };
    });

  const removeMember = (id: string) => {
    const list = current().members;
    const index = list.findIndex((m) => m.id === id);
    const member = list[index];
    if (!member) return;
    undoable({
      label: member.name.trim()
        ? `Removed “${shortName(member.name)}”`
        : "Removed an unnamed member",
      apply: () => {
        write((p) => ({ ...p, members: p.members.filter((m) => m.id !== id) }));
        log(CAPACITY_ACTIONS.MEMBER_REMOVED, { memberId: id, name: member.name });
      },
      revert: () => restoreMember(member, index),
    });
  };

  const updateMember = (id: string, updates: Partial<CapacityMember>) =>
    write((p) => ({
      ...p,
      members: p.members.map((m) => (m.id === id ? withUpdates(m, updates) : m)),
    }));

  // Config changes (length, events, focus, hours) also go to the history drawer.
  const updateConfig = (updates: Partial<CapacityPlan["config"]>) => {
    write((p) => ({ ...p, config: { ...p.config, ...updates } }));
    log(CAPACITY_ACTIONS.CONFIG_UPDATED, updates as Record<string, unknown>);
  };

  const hasMembers =
    members.length > 1 ||
    members.some((m) => m.name.trim() || m.role.trim() || m.description?.trim());

  const loadExample = () =>
    write((p) => ({
      ...p,
      members: [...buildExampleMembers(), ...p.members.filter((m) => !isBlankMember(m))],
    }));

  const clearExample = () => {
    const prev = current();
    undoable({
      label: "Cleared the example",
      apply: () => write((p) => ({ ...p, members: p.members.filter((m) => !isExampleId(m.id)) })),
      revert: () => savePlan(prev),
    });
  };

  // "Sync from team": a row for everyone on the Team page that has none yet,
  // matched by teamMemberId or name. Never removes a row; a second run is a
  // no-op. One Undo takes back the whole sync (see revertRosterSync).
  const syncFromTeam = () => {
    const before = current();
    const result = syncFromRoster(before.members, useWorkspaceStore.getState().teamMembers ?? []);
    if (result.added.length === 0 && result.changed.length === 0) {
      toast("Everyone on the team already has a row.");
      return;
    }
    const { label, description } = syncToastText(result);
    undoable({
      label,
      description,
      apply: () => {
        savePlan({ ...before, members: result.members });
        for (const m of result.added) {
          log(CAPACITY_ACTIONS.MEMBER_ADDED, {
            memberId: m.id,
            name: m.name,
            teamMemberId: m.teamMemberId,
            source: "team",
          });
        }
      },
      revert: () => write((p) => ({ ...p, members: revertRosterSync(p.members, result) })),
    });
  };

  const summary = useMemo(() => planCapacity(plan), [plan]);
  const breakdown = useMemo(() => hoursBreakdown(plan), [plan]);
  const hoursById = useMemo(
    () => new Map(summary.perMember.map((m) => [m.id, m.effectiveHours])),
    [summary]
  );
  const fullMemberHours = effectiveHours({ availability: 100, daysOff: 0 }, config);

  /* -- Export --------------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Name", "Role", "Description", "Availability %", "Days Off", "Effective Hours"],
      rows: members.map((m, i) => [
        m.name || "(unnamed)",
        m.role || "(no role)",
        m.description ?? "",
        m.availability,
        m.daysOff,
        summary.perMember[i].effectiveHours,
      ]),
    }),
    [members, summary]
  );

  const jsonData = useMemo(
    () => ({
      sprintId: sprint?.id,
      sprintConfig: config,
      members: members.map((m, i) => ({
        name: m.name || "(unnamed)",
        role: m.role || "(no role)",
        description: m.description,
        availability: m.availability,
        daysOff: m.daysOff,
        effectiveHours: summary.perMember[i].effectiveHours,
      })),
      totalCapacityHours: summary.totalHours,
    }),
    [sprint?.id, config, members, summary]
  );

  const clipboardText = useMemo(
    () =>
      [
        sprint ? `Sprint Capacity Planner — ${sprint.name}` : "Sprint Capacity Planner",
        `Sprint: ${config.sprintDays} days | Ceremony: ${config.ceremonyOverhead}% | Focus: ${config.focusFactor} | Hours/day: ${config.hoursPerDay}`,
        "",
        ...members.map(
          (m, i) =>
            `${m.name || "(unnamed)"} (${m.role || "N/A"}) - ${m.availability}% avail, ${m.daysOff} days off => ${summary.perMember[i].effectiveHours}h`
        ),
        "",
        `Total Capacity: ${summary.totalHours} hours`,
      ].join("\n"),
    [sprint, config, members, summary]
  );

  const markdown = useMemo(
    () => toMarkdown({ members, config, sprintName: sprint?.name, velocity }),
    [members, config, sprint?.name, velocity]
  );

  const promptConfig = useMemo(
    () => ({ toolName: "Capacity Planner", prompts: generateCapacityPrompts({ members, config }) }),
    [members, config]
  );

  return (
    <div className="space-y-6">
      {hasExampleItems(members) && <ExampleNotice onClear={clearExample} />}
      <div ref={exportRef} className="space-y-6">
        {/* ---- Summary ---- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Total Capacity"
            value={fmt(summary.totalHours)}
            unit="hours"
            icon={Zap}
          />
          <SummaryCard
            label="Team Size"
            value={members.length}
            unit={members.length === 1 ? "member" : "members"}
            icon={Users}
          />
          <SummaryCard
            label="Avg Availability"
            value={fmt(summary.avgAvailability)}
            unit="%"
            icon={UserCheck}
          />
          <SummaryCard
            label="Total Days Off"
            value={fmt(summary.totalDaysOff)}
            unit="days"
            icon={Clock}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <HoursBreakdownCard breakdown={breakdown} config={config} />
          <ForecastCard plan={plan} sprint={sprint} sprints={sprints} velocity={velocity} />
        </div>

        {/* ---- Sprint configuration ---- */}
        <SectionCard
          title="Sprint Configuration"
          icon={Settings2}
          titleSize="lg"
          headerClassName="pb-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Sprint length"
              value={config.sprintDays}
              onCommit={(v) => updateConfig({ sprintDays: v })}
              rule={{
                name: "sprint length",
                min: 1,
                max: MAX_SPRINT_DAYS,
                unit: " days",
                one: " day",
              }}
              step={1}
              suffix="days"
              hint={
                <SprintLengthHint
                  length={length}
                  sprintName={sprint?.name}
                  current={config.sprintDays}
                  onUse={() => updateConfig({ sprintDays: length.workingDays })}
                />
              }
            />
            <NumberField
              label="Ceremony overhead"
              value={config.ceremonyOverhead}
              onCommit={(v) => updateConfig({ ceremonyOverhead: v })}
              rule={{ name: "ceremony overhead", min: 0, max: 100, unit: "%" }}
              step={1}
              suffix="%"
              hint="Time in the Scrum events: planning, daily, refinement, review, retro."
            />
            <NumberField
              label="Focus factor"
              value={config.focusFactor}
              onCommit={(v) => updateConfig({ focusFactor: v })}
              rule={{ name: "focus factor", min: 0, max: 1 }}
              step={0.05}
              hint="The share of the hours left after the events that goes to sprint work. It covers everything else: support, other meetings, switching."
            />
            <NumberField
              label="Hours per day"
              value={config.hoursPerDay}
              onCommit={(v) => updateConfig({ hoursPerDay: v })}
              rule={{
                name: "length of a working day",
                min: 1,
                max: 24,
                unit: " hours",
                one: " hour",
              }}
              step={0.5}
              suffix="hrs"
            />
          </div>
          <PointsCommitted
            value={config.pointsCommitted ?? ""}
            label={sprint ? `Points committed to ${sprint.name}` : "Points committed (next sprint)"}
            onChange={(pointsCommitted) => updateConfig({ pointsCommitted })}
          />
        </SectionCard>

        {/* ---- Team members ---- */}
        <SectionCard
          title="Team Members"
          icon={Users}
          titleSize="lg"
          headerClassName="pb-4"
          contentClassName="space-y-4"
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename={sprint ? `sprint-capacity-${sprint.name}` : "sprint-capacity"}
                clipboardText={clipboardText}
                csvData={csvData}
                jsonData={jsonData}
                markdown={markdown}
                targetRef={exportRef}
              />
            </>
          }
        >
          {/* In the body, not the card's header: several buttons in a row don't fit a phone. */}
          <div className="flex flex-wrap gap-2">
            <SyncButton roster={roster} onSync={syncFromTeam} />
            <ResetButton
              variant="danger-ghost"
              title="Reset the capacity plan?"
              description={`All ${members.length} team member${members.length === 1 ? " is" : "s are"} removed and the sprint settings go back to their defaults.`}
              confirmLabel="Reset plan"
              doneLabel="Reset the capacity plan"
              onReset={() => {
                resetSnapshot.current = current();
                savePlan(emptyPlan(sprint?.id, length.workingDays));
                log(CAPACITY_ACTIONS.CAPACITY_RESET, sprint ? { sprintId: sprint.id } : {});
              }}
              onUndo={() => {
                if (resetSnapshot.current) savePlan(resetSnapshot.current);
              }}
            />
          </div>

          {!hasMembers && (
            <EmptyState padding="md" action={<LoadExampleButton onLoad={loadExample} />}>
              No team yet. Add each member&apos;s availability and days off to see the sprint&apos;s
              real capacity.
            </EmptyState>
          )}

          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              effectiveHours={hoursById.get(m.id) ?? 0}
              sprintDays={config.sprintDays}
              roster={roster}
              onUpdate={(updates) => updateMember(m.id, updates)}
              onRemove={() => removeMember(m.id)}
            />
          ))}

          <MemberAddForm sprintDays={config.sprintDays} roster={roster} onAdd={addMember} />

          <div className="flex items-center justify-between border-t border-border px-1 pt-4">
            <span className="text-sm font-medium text-sub">Sprint Total</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-data text-2xl font-bold text-accent">
                {fmt(summary.totalHours)}
              </span>
              <span className="text-sm text-sub">hours</span>
            </div>
          </div>
        </SectionCard>

        {/* ---- Per-person breakdown ---- */}
        {members.some((m) => m.name) && (
          <div>
            <h2 className="mb-4 font-display text-lg font-semibold text-text">
              Per-Person Breakdown
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members
                .filter((m) => m.name)
                .map((m) => {
                  const hours = hoursById.get(m.id) ?? 0;
                  // Share of what a fully available person with no days off gets.
                  const pct = fullMemberHours > 0 ? (hours / fullMemberHours) * 100 : 0;
                  return (
                    <Card key={m.id} className="border-border bg-surface">
                      <CardContent className="p-4">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text">{m.name}</p>
                            {m.role && <p className="text-xs text-sub">{m.role}</p>}
                            {m.description && (
                              <p className="mb-0.5 mt-0.5 whitespace-pre-wrap break-words text-xs text-sub">
                                {m.description}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 font-data text-xl font-bold text-accent">
                            {fmt(hours)}h
                          </span>
                        </div>
                        <div
                          className="h-2 w-full overflow-hidden rounded-full bg-card"
                          role="progressbar"
                          aria-label={`${m.name}: share of a full sprint`}
                          aria-valuenow={Math.round(Math.min(pct, 100))}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent transition-all duration-300"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-sub">
                          <span>{m.availability}% avail</span>
                          <span>
                            {m.daysOff} day{m.daysOff !== 1 ? "s" : ""} off
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Sync from team", or a link to set the team up while the roster is empty. */
function SyncButton({ roster, onSync }: { roster: readonly TeamMember[]; onSync: () => void }) {
  if (roster.length === 0) {
    return (
      <Button asChild size="sm" variant="ghost" className="gap-1.5">
        <Link href="/team" title="Add your team once and sync it here">
          <Users className="h-4 w-4" aria-hidden="true" />
          Set up team
        </Link>
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onSync}
      title="Add a row for everyone on the Team page"
      className="gap-1.5"
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      Sync from team
    </Button>
  );
}

/** Where the sprint length came from, with "Use N days" when the plan says otherwise. */
function SprintLengthHint({
  length,
  sprintName,
  current,
  onUse,
}: {
  length: SprintLength;
  sprintName?: string;
  current: number;
  onUse: () => void;
}) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{sprintLengthText(length, sprintName)}</span>
      {current !== length.workingDays && (
        <button
          type="button"
          onClick={onUse}
          className="min-touch-coarse rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Use {length.workingDays} {length.workingDays === 1 ? "day" : "days"}
        </button>
      )}
    </span>
  );
}

/** From full time to capacity, one deduction per line, with the verdict on top. */
function HoursBreakdownCard({
  breakdown: b,
  config,
}: {
  breakdown: ReturnType<typeof hoursBreakdown>;
  config: CapacityPlan["config"];
}) {
  const rows: [string, number][] = [
    [`Days off (${fmt(b.daysOff)} ${b.daysOff === 1 ? "day" : "days"})`, b.daysOffHours],
    ["Time away from the team (availability)", b.availabilityHours],
    [
      `Scrum events (${fmt(config.ceremonyOverhead)}% of the hours people are here)`,
      b.ceremonyHours,
    ],
    [
      `Other interruptions (focus factor ${config.focusFactor} of what's left)`,
      b.interruptionHours,
    ],
  ];
  return (
    <SectionCard title="Where the hours go" icon={PieChart}>
      <p className="mb-3 text-sm font-medium text-text" data-field="verdict">
        {capacityVerdict(b)}
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">
          Hours from full time down to the sprint&apos;s capacity
        </caption>
        <tbody className="divide-y divide-border">
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-text">
              Full time ({b.people} × {fmt(b.sprintDays)} days × {fmt(b.hoursPerDay)} h)
            </th>
            <td className="py-1.5 text-right font-data text-text">{fmt(b.fullTime)}</td>
          </tr>
          {rows.map(([label, hours]) => (
            <tr key={label}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-sub">
                − {label}
              </th>
              <td className="py-1.5 text-right font-data text-sub">
                {hours > 0 ? `−${fmt(hours)}` : "0"}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-text">
              Capacity for sprint work
            </th>
            <td className="py-1.5 text-right font-data font-semibold text-accent">
              {fmt(b.capacity)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-sub">
        The focus factor applies to the hours left after the Scrum events, so the events aren&apos;t
        counted twice.
      </p>
    </SectionCard>
  );
}

/** The points this capacity suggests, the way to Sprint Planning, and the velocity checks. */
function ForecastCard({
  plan,
  sprint,
  sprints,
  velocity,
}: {
  plan: CapacityPlan;
  sprint: Sprint | undefined;
  sprints: Sprint[];
  velocity: number | null;
}) {
  // Every finished sprint, oldest first by end date, for the checks below.
  const history = useMemo(
    () => velocityOf(sprints, { window: Number.POSITIVE_INFINITY }).points,
    [sprints]
  );
  const confident = enoughData(history.length, "forecast");
  const confidence = confident ? bayesianForecastConfidence(history) : null;
  const shifted = enoughData(history.length, "changePoint") && hasRecentChangepoint(history, 3);

  return (
    <SectionCard title="Points forecast" icon={Target}>
      <p className="text-sm text-text" data-field="forecast">
        {forecastSentence(plan, velocity)}
      </p>
      {shifted && (
        <p className="mt-2 text-xs text-sub">
          Velocity shifted in the last few sprints, so weigh the forecast with care (see the
          velocity checks below).
        </p>
      )}
      <Link
        href={sprintHref("/sprint-planning", sprint?.id)}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
      >
        {sprint ? `Plan ${sprint.name} in Sprint Planning` : "Open Sprint Planning"}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      <AdvancedAnalysis summary="Velocity checks" className="mt-4">
        {confidence ? (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-sub">Forecast confidence</span>
            <div
              className={cn(
                "inline-flex h-9 items-center rounded-md border px-3 font-mono text-xs uppercase tracking-wider",
                CONFIDENCE_TONE[confidence]
              )}
              title={`Bayesian forecast confidence from ${history.length} finished sprints`}
            >
              {confidence}
            </div>
            <p className="text-xs text-sub">
              How steady velocity has been across {history.length} finished sprints.
            </p>
          </div>
        ) : (
          <NotEnoughData
            have={history.length}
            need="forecast"
            unit={["finished sprint", "finished sprints"]}
            action="Finish"
            what="how steady the forecast is"
          />
        )}
        {enoughData(history.length, "changePoint") ? (
          shifted ? (
            <CalloutAlert tone="warning">
              <div>
                <div className="mb-0.5 font-semibold text-text">
                  Recent regime shift in velocity detected
                </div>
                <div className="text-sub">
                  CUSUM flagged a changepoint in the last few sprints, so older sprints may not be
                  representative. Lean on the sprints since the shift before relying on the
                  forecast.
                </div>
              </div>
            </CalloutAlert>
          ) : (
            <p className="text-xs text-sub">
              No recent shift in velocity: the last sprints look like the ones before.
            </p>
          )
        ) : (
          <NotEnoughData
            have={history.length}
            need="changePoint"
            unit={["finished sprint", "finished sprints"]}
            action="Finish"
            what="whether velocity has shifted"
          />
        )}
      </AdvancedAnalysis>
    </SectionCard>
  );
}

/** The commitment typed for the sprint, with the predicted default as a ghost value. */
function PointsCommitted({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const predicted = usePredictedDefault<number>(TOOL_ID, "pointsCommitted", 0);
  return (
    <div className="mt-5 max-w-sm space-y-1.5">
      <Label
        htmlFor="capacity-points-committed"
        className="flex items-center gap-1.5 text-sm text-text"
      >
        <Target className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Label>
      <SmartInput<number>
        predicted={predicted}
        onAccept={(v) => onChange(String(v))}
        render={({ ghost, chip, accept }) => (
          <div>
            <Input
              id="capacity-points-committed"
              type="number"
              min={0}
              value={value}
              placeholder={ghost ?? "e.g. 30"}
              onKeyDown={(e) => {
                if (e.key === "Tab" && value === "") {
                  e.preventDefault();
                  accept();
                }
              }}
              onChange={(e) => onChange(e.target.value)}
              className="font-data"
            />
            {chip}
          </div>
        )}
      />
    </div>
  );
}
