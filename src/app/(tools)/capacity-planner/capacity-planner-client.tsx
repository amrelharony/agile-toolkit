"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateCapacityPrompts } from "@/lib/ai-prompts/capacity-planner";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CAPACITY_ACTIONS } from "@/lib/history/event-actions";
import { SectionCard } from "@/components/shared/section-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Users, Plus, Trash2, Clock, Zap, UserCheck, Settings2, Target } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityPlan } from "@/lib/stores/workspace-types";
import { bayesianForecastConfidence } from "@/lib/analytics/forecasting-bayesian";
import { hasRecentChangepoint } from "@/lib/analytics/changepoint";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { SmartInput } from "@/components/shared/smart-input";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface TeamMember {
  id: string;
  name: string;
  role: string;
  description?: string;
  availability: number; // 0-100
  daysOff: number;
}

interface SprintConfig {
  sprintDays: number;
  ceremonyOverhead: number; // 0-100
  focusFactor: number; // 0-1
  hoursPerDay: number;
  /**
   * Optional planned commitment in story points for the next sprint. Surfaced
   * via SmartInput with a Bayesian forecast as the default suggestion. Stored
   * as a string so the input can be cleared without coercing to NaN/0 mid-edit.
   */
  pointsCommitted: string;
}

interface CapacityStore {
  members: TeamMember[];
  config: SprintConfig;
  addMember: () => void;
  removeMember: (id: string) => void;
  updateMember: (id: string, updates: Partial<TeamMember>) => void;
  updateConfig: (updates: Partial<SprintConfig>) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const defaultConfig: SprintConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};

const createMember = (): TeamMember => ({
  id: crypto.randomUUID(),
  name: "",
  role: "",
  availability: 100,
  daysOff: 0,
});

/** Deterministic ID for the first default member — guarantees server and
 *  client render the same DOM keys on first paint. User-added members
 *  get real UUIDs via `createMember()`. */
const defaultFirstMember: TeamMember = {
  id: "default:member-1",
  name: "",
  role: "",
  availability: 100,
  daysOff: 0,
};

// Capacity-planner state is now a singleton synced workspace document (was an
// isolated localStorage store), so MCP-written plans round-trip into the UI.
// `useCapacityStore` keeps the exact CapacityStore API the component consumes;
// each mutator reads the freshest doc via getState() to avoid clobbering.
// MUST match CP_ID in src/lib/actions/tools/capacity-planner.ts.
const CP_ID = "capacity-planner:current";

function defaultPlan(): CapacityPlan {
  return { id: CP_ID, members: [defaultFirstMember], config: { ...defaultConfig } };
}

function currentPlan(): CapacityPlan {
  return (
    (useWorkspaceStore.getState().capacityPlans ?? []).find((p) => p.id === CP_ID) ?? defaultPlan()
  );
}

function useCapacityStore(): CapacityStore {
  const plan = useWorkspaceStore(
    useShallow((s) => (s.capacityPlans ?? []).find((p) => p.id === CP_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertCapacityPlan);
  const cur = plan ?? defaultPlan();
  return {
    members: cur.members,
    config: cur.config,
    addMember: () =>
      upsert({ ...currentPlan(), members: [...currentPlan().members, createMember()] }),
    removeMember: (id) =>
      upsert({ ...currentPlan(), members: currentPlan().members.filter((m) => m.id !== id) }),
    updateMember: (id, updates) =>
      upsert({
        ...currentPlan(),
        members: currentPlan().members.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      }),
    updateConfig: (updates) =>
      upsert({ ...currentPlan(), config: { ...currentPlan().config, ...updates } }),
    reset: () => upsert({ id: CP_ID, members: [createMember()], config: { ...defaultConfig } }),
  };
}
// Non-reactive snapshot of members — used by the addMember log wrapper to read
// the just-appended member synchronously after the upsert.
useCapacityStore.getState = (): Pick<CapacityStore, "members"> => ({
  members: currentPlan().members,
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function calcEffectiveHours(member: TeamMember, config: SprintConfig): number {
  const workingDays = Math.max(config.sprintDays - member.daysOff, 0);
  return (
    workingDays *
    (member.availability / 100) *
    config.hoursPerDay *
    config.focusFactor *
    (1 - config.ceremonyOverhead / 100)
  );
}

function round(value: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function SummaryCard({
  label,
  value,
  unit,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-accent/10">
            <Icon className="w-5 h-5 text-accent" />
          </div>
          <span className="text-sm text-sub">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-data font-bold text-text">{value}</span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  // Lift the editing value into a local string draft and only commit on blur
  // (or Enter). The previous handler called Number(raw) on every keystroke and
  // a paste of "abc" — or a transient empty string while the user typed "0.5"
  // — would coerce to 0/NaN and silently zero out the focus factor (and thus
  // every team member's effective hours). Decimal entry like ".5" or "0.05"
  // is also broken when each keystroke is parsed and clamped immediately.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    // `Number("")` is 0, not NaN, so an emptied field slips past the
    // isFinite guard and commits 0 — zeroing the focus factor (and with it
    // every member's effective hours and Total Capacity) straight into the
    // synced workspace. Treat blank as invalid, like the burndown/burnup
    // drafts do.
    if (draft.trim() === "" || !Number.isFinite(n)) {
      // Invalid input — revert the draft to the live value rather than zeroing
      // a critical multiplier.
      setDraft(String(value));
      return;
    }
    let next = n;
    if (typeof min === "number") next = Math.max(min, next);
    if (typeof max === "number") next = Math.min(max, next);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sub text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          min={min}
          max={max}
          step={step}
          className="bg-surface border-border text-text font-data focus:border-accent/50 focus:ring-accent/20 pr-10"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-sub pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  effectiveHours,
  onUpdate,
  onRemove,
  canRemove,
}: {
  member: TeamMember;
  effectiveHours: number;
  onUpdate: (updates: Partial<TeamMember>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="md:grid md:grid-cols-[1fr_1fr_0.6fr_0.5fr_0.6fr_auto] md:gap-3 md:items-end">
        <div className="grid grid-cols-2 gap-2 md:contents">
          <div className="space-y-1.5 col-span-2">
            <Label className="text-sub text-xs">Name</Label>
            <Input
              placeholder="Team member"
              value={member.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="bg-surface border-border text-text focus:border-accent/50 focus:ring-accent/20"
            />
          </div>

          <div className="space-y-1.5 col-span-2">
            <Label className="text-sub text-xs">Role</Label>
            <Input
              placeholder="e.g. Developer"
              value={member.role}
              onChange={(e) => onUpdate({ role: e.target.value })}
              className="bg-surface border-border text-text focus:border-accent/50 focus:ring-accent/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Availability %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={member.availability}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  onUpdate({ availability: Math.min(100, Math.max(0, n)) });
                }
              }}
              className="bg-surface border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Days Off</Label>
            <Input
              type="number"
              min={0}
              value={member.daysOff}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  onUpdate({ daysOff: Math.max(0, n) });
                }
              }}
              className="bg-surface border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Eff. Hours</Label>
            <div className="h-9 flex items-center px-3 rounded-md bg-accent/5 border border-accent/20">
              <span className="font-data font-semibold text-accent">{round(effectiveHours)}</span>
            </div>
          </div>

          <div className="space-y-1.5 flex md:block flex-col items-end md:items-stretch">
            <Label className="text-sub text-xs invisible">Del</Label>
            <Button
              variant="danger-ghost"
              size="icon"
              disabled={!canRemove}
              onClick={onRemove}
              aria-label={`Remove member ${member.name || "(unnamed)"}`}
              className="h-9 w-9 disabled:opacity-30"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Optional description spans full row width below the inputs. */}
      <Textarea
        placeholder="Description (optional) — e.g. specialty, coverage notes..."
        value={member.description ?? ""}
        onChange={(e) =>
          onUpdate({
            description: e.target.value.trim() ? e.target.value : undefined,
          })
        }
        rows={2}
        className="bg-surface border-border resize-none text-xs text-text"
        aria-label={`Description for ${member.name || "member"}`}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                     */
/* -------------------------------------------------------------------------- */

export function CapacityPlannerClient() {
  const {
    members,
    config,
    addMember: addMemberRaw,
    removeMember: removeMemberRaw,
    updateMember,
    updateConfig: updateConfigRaw,
    reset: resetRaw,
  } = useCapacityStore();
  const { log } = useHistoryLogger("capacity-planner");

  /* -- Velocity history (from workspace store, which the predictor also uses) */
  const velocityHistory = useWorkspaceStore(
    useShallow((s): number[] =>
      s.sprints
        .filter((sp) => sp.status === "completed" && Number.isFinite(sp.pointsCompleted))
        .map((sp) => sp.pointsCompleted ?? 0)
    )
  );

  const forecastConfidence = useMemo(
    () => bayesianForecastConfidence(velocityHistory),
    [velocityHistory]
  );

  const recentRegimeShift = useMemo(
    () => hasRecentChangepoint(velocityHistory, 3),
    [velocityHistory]
  );

  /* -- SmartInput predicted default for points-committed -------------------- */
  const pointsCommittedPred = usePredictedDefault<number>("capacity-planner", "pointsCommitted", 0);

  const addMember: typeof addMemberRaw = (...args) => {
    addMemberRaw(...args);
    const list = useCapacityStore.getState().members;
    const created = list[list.length - 1];
    log(CAPACITY_ACTIONS.MEMBER_ADDED, { memberId: created?.id, name: created?.name });
  };
  const removeMember: typeof removeMemberRaw = (id) => {
    const member = members.find((m) => m.id === id);
    removeMemberRaw(id);
    log(CAPACITY_ACTIONS.MEMBER_REMOVED, { memberId: id, name: member?.name });
  };
  // Wrap updateConfig so config changes (sprintDays, ceremony, focus, hours)
  // also surface in the history drawer — mirrors the burndown/burnup pattern.
  const updateConfig: typeof updateConfigRaw = (updates) => {
    updateConfigRaw(updates);
    log(CAPACITY_ACTIONS.CONFIG_UPDATED, updates as Record<string, unknown>);
  };
  const reset = () => {
    resetRaw();
    log(CAPACITY_ACTIONS.CAPACITY_RESET, {});
  };

  const exportRef = useRef<HTMLDivElement>(null);

  const calculations = useMemo(() => {
    const perMember = members.map((m) => ({
      ...m,
      effectiveHours: calcEffectiveHours(m, config),
    }));
    const totalHours = perMember.reduce((sum, m) => sum + m.effectiveHours, 0);
    const avgAvailability =
      members.length > 0 ? members.reduce((sum, m) => sum + m.availability, 0) / members.length : 0;
    const totalDaysOff = members.reduce((sum, m) => sum + m.daysOff, 0);

    return { perMember, totalHours, avgAvailability, totalDaysOff };
  }, [members, config]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Name", "Role", "Description", "Availability %", "Days Off", "Effective Hours"],
      rows: calculations.perMember.map((m) => [
        m.name || "(unnamed)",
        m.role || "(no role)",
        m.description ?? "",
        m.availability,
        m.daysOff,
        round(m.effectiveHours),
      ]),
    }),
    [calculations.perMember]
  );

  const jsonData = useMemo(
    () => ({
      sprintConfig: config,
      members: calculations.perMember.map((m) => ({
        name: m.name || "(unnamed)",
        role: m.role || "(no role)",
        description: m.description,
        availability: m.availability,
        daysOff: m.daysOff,
        effectiveHours: round(m.effectiveHours),
      })),
      totalCapacityHours: round(calculations.totalHours),
    }),
    [config, calculations]
  );

  const clipboardText = useMemo(() => {
    const lines = [
      `Sprint Capacity Planner`,
      `Sprint: ${config.sprintDays} days | Ceremony: ${config.ceremonyOverhead}% | Focus: ${config.focusFactor} | Hours/day: ${config.hoursPerDay}`,
      ``,
      ...calculations.perMember.map(
        (m) =>
          `${m.name || "(unnamed)"} (${m.role || "N/A"}) - ${m.availability}% avail, ${m.daysOff} days off => ${round(m.effectiveHours)}h`
      ),
      ``,
      `Total Capacity: ${round(calculations.totalHours)} hours`,
    ];
    return lines.join("\n");
  }, [config, calculations]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Capacity Planner",
      prompts: generateCapacityPrompts({ members, config }),
    }),
    [members, config]
  );

  /* -- Render ------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="capacity-planner"
      title="Sprint Capacity Planner"
      description="Calculate your team's effective sprint capacity based on availability, time off, ceremony overhead, and focus factor."
      category="Sprint Planning & Estimation"
    >
      <div ref={exportRef} className="space-y-6">
        {/* ---- Summary Cards ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Capacity"
            value={round(calculations.totalHours)}
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
            value={round(calculations.avgAvailability)}
            unit="%"
            icon={UserCheck}
          />
          <SummaryCard
            label="Total Days Off"
            value={calculations.totalDaysOff}
            unit="days"
            icon={Clock}
          />
        </div>

        {/* ---- Velocity regime-shift advisory ---- */}
        {recentRegimeShift && velocityHistory.length >= 5 && (
          <CalloutAlert tone="warning">
            <div>
              <div className="font-semibold mb-0.5 text-text">
                Recent regime shift in velocity detected
              </div>
              <div className="text-sub">
                CUSUM flagged a changepoint in the last few sprints — historical commitments may not
                be representative. Trim the sample to the post-shift window before relying on the
                suggested commitment.
              </div>
            </div>
          </CalloutAlert>
        )}

        {/* ---- Sprint Configuration ---- */}
        <SectionCard
          title="Sprint Configuration"
          icon={Settings2}
          titleSize="lg"
          headerClassName="pb-4"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ConfigField
              label="Sprint Length"
              value={config.sprintDays}
              onChange={(v) => updateConfig({ sprintDays: v })}
              min={1}
              max={30}
              step={1}
              suffix="days"
            />
            <ConfigField
              label="Ceremony Overhead"
              value={config.ceremonyOverhead}
              onChange={(v) => updateConfig({ ceremonyOverhead: v })}
              min={0}
              max={100}
              step={1}
              suffix="%"
            />
            <ConfigField
              label="Focus Factor"
              value={config.focusFactor}
              onChange={(v) => updateConfig({ focusFactor: v })}
              min={0}
              max={1}
              step={0.05}
            />
            <ConfigField
              label="Hours per Day"
              value={config.hoursPerDay}
              onChange={(v) => updateConfig({ hoursPerDay: v })}
              min={1}
              max={24}
              step={0.5}
              suffix="hrs"
            />
          </div>

          {/* SmartInput — points committed (next sprint). */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sub text-xs flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5" />
                Points Committed (next sprint)
              </Label>
              <SmartInput<number>
                predicted={pointsCommittedPred}
                onAccept={(v) => updateConfig({ pointsCommitted: String(v) })}
                render={({ ghost, chip, accept }) => (
                  <div>
                    <Input
                      type="number"
                      min={0}
                      value={config.pointsCommitted ?? ""}
                      placeholder={ghost ?? "e.g. 30"}
                      onKeyDown={(e) => {
                        if (e.key === "Tab" && (config.pointsCommitted ?? "") === "") {
                          e.preventDefault();
                          accept();
                        }
                      }}
                      onChange={(e) => updateConfig({ pointsCommitted: e.target.value })}
                      className="bg-surface border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                    />
                    {chip}
                  </div>
                )}
              />
            </div>

            {/* Forecast-confidence chip — sourced from Bayesian shrinkage on the
                velocity history. Only shown when there's a non-trivial sample. */}
            {velocityHistory.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-sub text-xs">Forecast confidence</Label>
                <div
                  className="h-9 inline-flex items-center px-3 rounded-md border text-xs font-mono uppercase tracking-wider"
                  style={{
                    color:
                      forecastConfidence === "high"
                        ? "#22c55e"
                        : forecastConfidence === "medium"
                          ? "#eab308"
                          : "#94a3b8",
                    borderColor:
                      forecastConfidence === "high"
                        ? "rgba(34,197,94,0.4)"
                        : forecastConfidence === "medium"
                          ? "rgba(234,179,8,0.4)"
                          : "rgba(148,163,184,0.4)",
                    background:
                      forecastConfidence === "high"
                        ? "rgba(34,197,94,0.08)"
                        : forecastConfidence === "medium"
                          ? "rgba(234,179,8,0.08)"
                          : "rgba(148,163,184,0.08)",
                  }}
                  title={`Bayesian forecast confidence based on ${velocityHistory.length} completed sprint${velocityHistory.length === 1 ? "" : "s"}`}
                >
                  {forecastConfidence}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ---- Team Members ---- */}
        <SectionCard
          title="Team Members"
          icon={Users}
          titleSize="lg"
          headerClassName="pb-4"
          contentClassName="space-y-3"
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="sprint-capacity"
                clipboardText={clipboardText}
                csvData={csvData}
                jsonData={jsonData}
                targetRef={exportRef}
              />
              <Button variant="danger-ghost" size="sm" onClick={reset}>
                Reset
              </Button>
              <Button size="sm" variant="toolkit" onClick={addMember} className="gap-1.5">
                <Plus className="w-4 h-4" />
                Add Member
              </Button>
            </>
          }
        >
          {/* Column headers (visible on md+) */}
          <div className="hidden md:grid grid-cols-[1fr_1fr_0.6fr_0.5fr_0.6fr_auto] gap-3 px-1 pb-1 border-b border-border">
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Name</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Role</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Availability
            </span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">Days Off</span>
            <span className="text-xs text-sub font-medium uppercase tracking-wider">
              Eff. Hours
            </span>
            <span className="w-9" />
          </div>

          {calculations.perMember.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              effectiveHours={m.effectiveHours}
              onUpdate={(updates) => updateMember(m.id, updates)}
              onRemove={() => removeMember(m.id)}
              canRemove={members.length > 1}
            />
          ))}

          {/* Total bar */}
          <div className="mt-4 pt-4 border-t border-border flex items-center justify-between px-1">
            <span className="text-sm font-medium text-sub">Sprint Total</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-data font-bold text-accent">
                {round(calculations.totalHours)}
              </span>
              <span className="text-sm text-sub">hours</span>
            </div>
          </div>
        </SectionCard>

        {/* ---- Per-person Breakdown Cards ---- */}
        {calculations.perMember.some((m) => m.name) && (
          <div>
            <h2 className="text-lg font-display font-semibold text-text mb-4">
              Per-Person Breakdown
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {calculations.perMember
                .filter((m) => m.name)
                .map((m) => {
                  const maxHours =
                    config.sprintDays *
                    config.hoursPerDay *
                    config.focusFactor *
                    (1 - config.ceremonyOverhead / 100);
                  const pct = maxHours > 0 ? (m.effectiveHours / maxHours) * 100 : 0;

                  return (
                    <Card key={m.id} className="bg-surface border-border">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text">{m.name}</p>
                            {m.role && <p className="text-xs text-sub">{m.role}</p>}
                            {m.description && (
                              <p className="text-sub text-[11px] mt-0.5 mb-0.5 whitespace-pre-wrap break-words">
                                {m.description}
                              </p>
                            )}
                          </div>
                          <span className="text-xl font-data font-bold text-accent shrink-0">
                            {round(m.effectiveHours)}h
                          </span>
                        </div>
                        {/* Capacity bar */}
                        <div
                          className="w-full h-2 rounded-full bg-card overflow-hidden"
                          role="progressbar"
                          aria-label={`${m.name || "Member"} capacity utilisation`}
                          aria-valuenow={Math.round(Math.min(pct, 100))}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#00f0ff]/60 to-[#00f0ff] transition-all duration-300"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-xs text-sub">
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
    </ToolPageWrapper>
  );
}
