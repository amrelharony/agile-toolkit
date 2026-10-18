"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, CalendarRange, AlertCircle } from "lucide-react";
import { simulateVelocityDistribution } from "@/lib/analytics/monte-carlo";
import { generatePiPlanningPrompts } from "@/lib/ai-prompts/pi-planning";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";

interface PiTeam {
  id: string;
  name: string;
  description?: string;
  velocity: number;
}

interface PiItem {
  id: string;
  title: string;
  description?: string;
  teamId: string;
  iteration: number;
  points: number;
  kind: "feature" | "dependency" | "risk";
}

interface State {
  teams: PiTeam[];
  items: PiItem[];
  iterations: number;
}

const DEFAULT_STATE: State = { teams: [], items: [], iterations: 5 };

const KIND_COLORS: Record<PiItem["kind"], string> = {
  feature: "#00f0ff",
  dependency: "#f59e0b",
  risk: "#ef4444",
};

export function PiPlanningClient() {
  const [state, setState] = usePersisted<State>("agile-toolkit:pi-planning", DEFAULT_STATE);
  const [newTeam, setNewTeam] = useState({ name: "", velocity: 20, description: "" });
  const { log } = useHistoryLogger("pi-planning");

  const addTeam = () => {
    if (!newTeam.name.trim()) return;
    const description = newTeam.description.trim() || undefined;
    const team: PiTeam = {
      id: nanoid(6),
      name: newTeam.name.trim(),
      velocity: newTeam.velocity,
      description,
    };
    setState((s) => ({ ...s, teams: [...s.teams, team] }));
    log(PI_PLANNING_ACTIONS.TEAM_ADDED, { teamId: team.id, name: team.name, description });
    setNewTeam({ name: "", velocity: 20, description: "" });
  };
  const removeTeam = (id: string) => {
    const team = state.teams.find((t) => t.id === id);
    setState((s) => ({
      ...s,
      teams: s.teams.filter((t) => t.id !== id),
      items: s.items.filter((i) => i.teamId !== id),
    }));
    log(PI_PLANNING_ACTIONS.TEAM_REMOVED, { teamId: id, name: team?.name });
  };
  const updateTeam = (id: string, patch: Partial<PiTeam>) =>
    setState((s) => ({ ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const addItem = (teamId: string, iteration: number) => {
    const item = {
      id: nanoid(6),
      title: "",
      teamId,
      iteration,
      points: 3,
      kind: "feature" as const,
    };
    setState((s) => ({ ...s, items: [...s.items, item] }));
    log(PI_PLANNING_ACTIONS.ITEM_ADDED, { itemId: item.id, teamId, iteration });
  };
  const updateItem = (id: string, patch: Partial<PiItem>) => {
    setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    if (patch.iteration !== undefined || patch.teamId !== undefined) {
      log(PI_PLANNING_ACTIONS.ITEM_ASSIGNED, { itemId: id, ...patch });
    } else if (patch.kind !== undefined || patch.points !== undefined) {
      // Only audit structural changes (kind, points) — not per-keystroke
      // title/description edits, which used to flood the history log with
      // one event per character and slowed the whole tool on typing.
      log(PI_PLANNING_ACTIONS.ITEM_UPDATED, { itemId: id, ...patch });
    }
  };
  const removeItem = (id: string) => {
    const item = state.items.find((i) => i.id === id);
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
    log(PI_PLANNING_ACTIONS.ITEM_REMOVED, { itemId: id, title: item?.title });
  };

  const setIterations = (n: number) =>
    setState((s) => {
      const next = Math.max(1, Math.min(10, n));
      // R5: when the user types `0`, `next` clamps to 1 but `next < s.iterations`
      // (if current is e.g. 2) → destructive prompt + item removal still fires
      // even though the user's intent was clamped to a value that may equal
      // current. Skip the destructive path when the clamped value equals
      // current (no actual shrink happening) and when the typed value was
      // outside the allowed range entirely (typed 0 / 11 / negative).
      if (next === s.iterations) return s;
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        // Typed value was outside bounds — silently treat as no-op.
        return s;
      }
      if (next < s.iterations) {
        const orphans = s.items.filter((i) => i.iteration >= next).length;
        if (orphans > 0) {
          const ok =
            typeof window !== "undefined" &&
            window.confirm(
              `Reducing iterations to ${next} will remove ${orphans} item${
                orphans === 1 ? "" : "s"
              } pinned to iteration ${next + 1} or later. Continue?`
            );
          if (!ok) return s;
        }
        return { ...s, iterations: next, items: s.items.filter((i) => i.iteration < next) };
      }
      return { ...s, iterations: next };
    });

  const overloads = useMemo(() => {
    const out: { teamId: string; iteration: number; planned: number; capacity: number }[] = [];
    for (const team of state.teams) {
      // A team with velocity 0 (or unset) has no capacity to compare against,
      // so every scheduled feature would falsely register as overload. Skip
      // such teams; the UI prompts the user to enter a velocity instead.
      if (team.velocity <= 0) continue;
      for (let it = 0; it < state.iterations; it++) {
        const planned = state.items
          .filter((i) => i.teamId === team.id && i.iteration === it && i.kind === "feature")
          .reduce((a, b) => a + b.points, 0);
        if (planned > team.velocity * 1.15) {
          out.push({ teamId: team.id, iteration: it, planned, capacity: team.velocity });
        }
      }
    }
    return out;
  }, [state.teams, state.items, state.iterations]);

  const totalScope = useMemo(
    () => state.items.filter((i) => i.kind === "feature").reduce((a, b) => a + b.points, 0),
    [state.items]
  );
  // Memo on state.teams (stable identity across unrelated renders) so the
  // 5,000-iter Monte Carlo doesn't re-run on every keystroke. Previously the
  // velocities array was recomputed inline each render → forecast useMemo's
  // dep changed identity → simulation re-ran constantly.
  const velocities = useMemo(
    () => state.teams.map((t) => t.velocity).filter((v) => v > 0),
    [state.teams]
  );
  // We only have one velocity per team (no historical samples per team), so
  // we can't model "iterations to clear backlog" — feeding individual team
  // velocities into simulateThroughputCompletion would treat each draw as a
  // single-iteration team-of-one, dramatically overestimating effort.
  // Downscoped to a per-team velocity distribution (P85 = the velocity you'd
  // expect 85% of teams to hit or beat in a given iteration).
  const forecast = useMemo(() => {
    if (velocities.length === 0) return null;
    return simulateVelocityDistribution(velocities, 5000);
  }, [velocities]);

  const promptConfig = useMemo(
    () => ({
      toolName: "PI Planning Board",
      prompts: generatePiPlanningPrompts({
        teams: state.teams,
        items: state.items,
        iterations: state.iterations,
        overloads,
      }),
    }),
    [state, overloads]
  );

  // ── Cross-tool signal: sprints completed during the PI window ───────────
  // PI commitments roll forward as constituent sprints complete. Surface a
  // small chip with the count so the user can sanity-check whether the
  // board's iteration count and team velocities still reflect reality.
  const events = useHistoryStore((s) => s.events);
  const sprintsSincePiStart = useMemo(
    () =>
      selectEvents({
        toolId: "velocity",
        action: "sprint_added",
        sinceDays: 90,
        limit: 50,
      }),
    [events]
  );

  return (
    <ToolPageWrapper
      toolId="pi-planning"
      title="PI Planning Board"
      description="SAFe Program Increment board — teams × iterations with features, dependencies, and risks."
      category="Portfolio & Scaling"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="pi-planning"
          csvData={{
            headers: [
              "Team",
              "Team Description",
              "Iteration",
              "Item",
              "Item Description",
              "Points",
              "Kind",
            ],
            rows: state.items.map((i) => {
              const team = state.teams.find((t) => t.id === i.teamId);
              return [
                team?.name ?? "",
                team?.description ?? "",
                i.iteration + 1,
                i.title,
                i.description ?? "",
                i.points,
                i.kind,
              ];
            }),
          }}
          jsonData={state}
        />
      </ActionRow>

      {sprintsSincePiStart.length > 0 && (
        <div className="mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/5 text-accent px-2.5 py-1 text-xs">
            {sprintsSincePiStart.length} sprint{sprintsSincePiStart.length === 1 ? "" : "s"}{" "}
            completed since PI start
          </span>
        </div>
      )}

      <KpiGrid cols={4} marginBottom="md">
        <StatCard
          variant="compact"
          label="Teams"
          value={state.teams.length}
          valueClassName="text-accent"
        />
        <StatCard variant="compact" label="Features (pts)" value={totalScope} />
        <StatCard
          variant="compact"
          label="P85 team velocity"
          value={forecast ? Math.round(forecast.percentiles[85]) : "—"}
          hint={`points per iter, ${state.teams.length} teams sampled`}
        />
        <StatCard
          variant="compact"
          label="Overloads"
          value={overloads.length}
          hint="teams/iter > 115% cap"
          tone={overloads.length > 0 ? "danger" : "default"}
        />
      </KpiGrid>

      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="pi-iterations" className="block text-xs text-sub">
                Iterations in PI
              </label>
              <Input
                id="pi-iterations"
                type="number"
                min={1}
                max={10}
                value={state.iterations}
                onChange={(e) => {
                  // Empty input coerces via Number() to 0, which would clamp to
                  // min=1 and silently delete iteration columns. Keep the
                  // current value while the field is empty mid-edit so the
                  // user can retype freely.
                  const raw = e.target.value;
                  if (raw === "") return;
                  const n = Number(raw);
                  if (Number.isFinite(n)) setIterations(n);
                }}
                className="bg-bg border-border font-data w-24"
              />
            </div>
            <div className="flex-1" />
            <Input
              value={newTeam.name}
              onChange={(e) => setNewTeam((n) => ({ ...n, name: e.target.value }))}
              placeholder="New team name"
              aria-label="New team name"
              className="bg-bg border-border w-48"
            />
            <Input
              type="number"
              value={newTeam.velocity}
              // R11-fix: guard against NaN from non-numeric paste / clear.
              // The previous `Number(e.target.value)` returned NaN, which
              // then propagated through overload detection
              // (`planned > team.velocity * 1.15` → false) silently
              // disabling the load warning. Now: keep prior value on
              // invalid input.
              onChange={(e) => {
                const n = Number(e.target.value);
                setNewTeam((nt) => ({
                  ...nt,
                  velocity: Number.isFinite(n) && n >= 0 ? n : nt.velocity,
                }));
              }}
              placeholder="Velocity"
              aria-label="New team velocity"
              className="bg-bg border-border font-data w-24"
            />
            <Button onClick={addTeam} className="gap-2 bg-accent text-bg hover:bg-accent/90">
              <Plus className="w-4 h-4" />
              Add Team
            </Button>
          </div>
          <Textarea
            value={newTeam.description}
            onChange={(e) => setNewTeam((n) => ({ ...n, description: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addTeam();
            }}
            placeholder="Team description (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="New team description"
          />
        </CardContent>
      </Card>

      <div className="table-wrap-responsive">
        <table className="min-w-full border-separate border-spacing-2">
          <thead>
            <tr>
              <th className="text-left text-xs text-sub uppercase tracking-wider w-40">Team</th>
              {Array.from({ length: state.iterations }).map((_, it) => (
                <th
                  key={it}
                  className="text-left text-xs text-sub uppercase tracking-wider min-w-[180px]"
                >
                  Iteration {it + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.teams.map((team) => (
              <tr key={team.id}>
                <td className="align-top">
                  <Card className="bg-surface border-border">
                    <CardContent className="p-2 space-y-1">
                      <BlurInput
                        value={team.name}
                        onCommit={(v) => updateTeam(team.id, { name: v })}
                        aria-label="Team name"
                        className="bg-bg border-border text-sm h-8"
                      />
                      {team.description && (
                        <div className="text-sub text-xs mt-0.5 mb-1.5 whitespace-pre-wrap break-words">
                          {team.description}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={team.velocity}
                          // R11-fix: NaN-guard. Bad paste silently
                          // disabled overload detection before.
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n >= 0) updateTeam(team.id, { velocity: n });
                          }}
                          className="bg-bg border-border font-data text-xs h-7 w-20"
                          aria-label={`Velocity for ${team.name || "team"}`}
                        />
                        <span className="text-xs text-sub">vel</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTeam(team.id)}
                          aria-label={`Remove team ${team.name}`.trim()}
                          className="ml-auto h-7 text-sub hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </td>
                {Array.from({ length: state.iterations }).map((_, it) => {
                  const items = state.items.filter(
                    (i) => i.teamId === team.id && i.iteration === it
                  );
                  const planned = items
                    .filter((i) => i.kind === "feature")
                    .reduce((a, b) => a + b.points, 0);
                  // Mirror the `overloads` memo's guard: a velocity-0 team has
                  // no capacity to compare against, so it must never render as
                  // overloaded (else red cells contradict the "0 overloads" KPI).
                  const over = team.velocity > 0 && planned > team.velocity * 1.15;
                  return (
                    <td key={it} className="align-top">
                      <div
                        className={`rounded-lg border p-2 space-y-1 min-h-[100px] ${over ? "border-danger/40 bg-danger/5" : "border-border bg-surface"}`}
                      >
                        <div className="flex items-center justify-between text-xs text-sub font-data">
                          <span>
                            {planned} / {team.velocity}
                          </span>
                          {over && (
                            <>
                              <AlertCircle className="w-3 h-3 text-danger" />
                              <span className="sr-only">Over capacity</span>
                            </>
                          )}
                        </div>
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="rounded border border-border bg-bg p-1.5 space-y-1"
                            style={{ borderLeftWidth: 3, borderLeftColor: KIND_COLORS[item.kind] }}
                          >
                            {/* BUG-T6-pi-planning-3: commit-on-blur for
                                title + description so a board with many
                                items doesn't write to localStorage on
                                every keystroke. */}
                            <BlurInput
                              value={item.title}
                              onCommit={(v) => updateItem(item.id, { title: v })}
                              placeholder="Item"
                              className="bg-surface border-border text-xs h-6"
                              aria-label="Item title"
                            />
                            <BlurTextarea
                              value={item.description ?? ""}
                              onCommit={(v) =>
                                updateItem(item.id, { description: v.trim() ? v : undefined })
                              }
                              placeholder="Description (optional)..."
                              rows={2}
                              className="bg-surface border-border resize-none text-xs py-1"
                              aria-label="Item description"
                            />
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={item.points}
                                // R11-fix: NaN-guard. Without this, a
                                // single bad-paste row poisons the team's
                                // `planned` reduce → NaN > velocity is
                                // false → overload silently hidden.
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  if (Number.isFinite(n) && n >= 0)
                                    updateItem(item.id, { points: n });
                                }}
                                className="bg-surface border-border font-data text-xs h-6 w-12"
                                aria-label="Item points"
                              />
                              <select
                                value={item.kind}
                                onChange={(e) =>
                                  updateItem(item.id, { kind: e.target.value as PiItem["kind"] })
                                }
                                className="bg-surface border border-border rounded text-xs h-6 flex-1 px-1"
                                aria-label="Item kind"
                              >
                                <option value="feature">feature</option>
                                <option value="dependency">dep</option>
                                <option value="risk">risk</option>
                              </select>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeItem(item.id)}
                                aria-label={`Remove item ${item.title}`.trim()}
                                className="h-5 w-5 p-0 text-sub hover:text-danger"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => addItem(team.id, it)}
                          aria-label={`Add item to ${team.name || "team"}, iteration ${it + 1}`}
                          className="w-full h-6 text-xs text-sub hover:text-accent"
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {state.teams.length === 0 && (
              <tr>
                <td colSpan={state.iterations + 1} className="text-center text-sub py-8">
                  <CalendarRange className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  Add teams to build your PI board.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ToolPageWrapper>
  );
}
