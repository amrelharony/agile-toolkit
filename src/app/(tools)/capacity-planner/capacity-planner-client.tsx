"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateCapacityPrompts } from "@/lib/ai-prompts/capacity-planner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Users,
  Plus,
  Trash2,
  Clock,
  Zap,
  UserCheck,
  Settings2,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface TeamMember {
  id: string;
  name: string;
  role: string;
  availability: number; // 0-100
  daysOff: number;
}

interface SprintConfig {
  sprintDays: number;
  ceremonyOverhead: number; // 0-100
  focusFactor: number; // 0-1
  hoursPerDay: number;
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
};

const createMember = (): TeamMember => ({
  id: crypto.randomUUID(),
  name: "",
  role: "",
  availability: 100,
  daysOff: 0,
});

const useCapacityStore = create<CapacityStore>()(
  persist(
    (set) => ({
      members: [createMember()],
      config: { ...defaultConfig },

      addMember: () =>
        set((s) => ({ members: [...s.members, createMember()] })),

      removeMember: (id) =>
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
        })),

      updateMember: (id, updates) =>
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        })),

      updateConfig: (updates) =>
        set((s) => ({ config: { ...s.config, ...updates } })),

      reset: () =>
        set({ members: [createMember()], config: { ...defaultConfig } }),
    }),
    { name: "agile-toolkit:capacity-planner" }
  )
);

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
          <span className="text-3xl font-data font-bold text-text">
            {value}
          </span>
          {unit && (
            <span className="text-sm text-sub">{unit}</span>
          )}
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
  return (
    <div className="space-y-1.5">
      <Label className="text-sub text-xs">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
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
    <div className="grid grid-cols-[1fr_1fr_0.6fr_0.5fr_0.6fr_auto] gap-3 items-end">
      <div className="space-y-1.5">
        <Label className="text-sub text-xs">Name</Label>
        <Input
          placeholder="Team member"
          value={member.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="bg-surface border-border text-text focus:border-accent/50 focus:ring-accent/20"
        />
      </div>

      <div className="space-y-1.5">
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
          onChange={(e) =>
            onUpdate({
              availability: Math.min(100, Math.max(0, Number(e.target.value))),
            })
          }
          className="bg-surface border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sub text-xs">Days Off</Label>
        <Input
          type="number"
          min={0}
          value={member.daysOff}
          onChange={(e) =>
            onUpdate({ daysOff: Math.max(0, Number(e.target.value)) })
          }
          className="bg-surface border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sub text-xs">Eff. Hours</Label>
        <div className="h-9 flex items-center px-3 rounded-md bg-accent/5 border border-accent/20">
          <span className="font-data font-semibold text-accent">
            {round(effectiveHours)}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sub text-xs invisible">Del</Label>
        <Button
          variant="ghost"
          size="icon"
          disabled={!canRemove}
          onClick={onRemove}
          className="h-9 w-9 text-sub hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                     */
/* -------------------------------------------------------------------------- */

export function CapacityPlannerClient() {
  const { members, config, addMember, removeMember, updateMember, updateConfig, reset } =
    useCapacityStore();

  const exportRef = useRef<HTMLDivElement>(null);

  const calculations = useMemo(() => {
    const perMember = members.map((m) => ({
      ...m,
      effectiveHours: calcEffectiveHours(m, config),
    }));
    const totalHours = perMember.reduce((sum, m) => sum + m.effectiveHours, 0);
    const avgAvailability =
      members.length > 0
        ? members.reduce((sum, m) => sum + m.availability, 0) / members.length
        : 0;
    const totalDaysOff = members.reduce((sum, m) => sum + m.daysOff, 0);

    return { perMember, totalHours, avgAvailability, totalDaysOff };
  }, [members, config]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Name", "Role", "Availability %", "Days Off", "Effective Hours"],
      rows: calculations.perMember.map((m) => [
        m.name || "(unnamed)",
        m.role || "(no role)",
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

  const promptConfig = useMemo(() => ({
    toolName: "Capacity Planner",
    prompts: generateCapacityPrompts({ members, config }),
  }), [members, config]);

  /* -- Render ------------------------------------------------------------- */

  return (
    <ToolPageWrapper
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

        {/* ---- Sprint Configuration ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
              <Settings2 className="w-5 h-5 text-accent" />
              Sprint Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* ---- Team Members ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <Users className="w-5 h-5 text-accent" />
                Team Members
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="sprint-capacity"
                  clipboardText={clipboardText}
                  csvData={csvData}
                  jsonData={jsonData}
                  targetRef={exportRef}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="text-sub hover:text-red-400 hover:bg-red-400/10"
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={addMember}
                  className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40"
                >
                  <Plus className="w-4 h-4" />
                  Add Member
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Column headers (visible on md+) */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_0.6fr_0.5fr_0.6fr_auto] gap-3 px-1 pb-1 border-b border-border">
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Name
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Role
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Availability
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Days Off
              </span>
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
              <span className="text-sm font-medium text-sub">
                Sprint Total
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-data font-bold text-accent">
                  {round(calculations.totalHours)}
                </span>
                <span className="text-sm text-sub">hours</span>
              </div>
            </div>
          </CardContent>
        </Card>

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
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-medium text-text">
                              {m.name}
                            </p>
                            {m.role && (
                              <p className="text-xs text-sub">
                                {m.role}
                              </p>
                            )}
                          </div>
                          <span className="text-xl font-data font-bold text-accent">
                            {round(m.effectiveHours)}h
                          </span>
                        </div>
                        {/* Capacity bar */}
                        <div className="w-full h-2 rounded-full bg-card overflow-hidden">
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
