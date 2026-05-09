"use client";

import { useEffect, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Map as MapIcon,
  GitBranch,
  TrendingUp,
} from "lucide-react";
import { generateWardleyMapPrompts } from "@/lib/ai-prompts/wardley-map";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WARDLEY_ACTIONS } from "@/lib/history/event-actions";

interface Component {
  id: string;
  name: string;
  /** 0 = Genesis, 1 = Commodity (X axis). */
  evolution: number;
  /** 0 = invisible to user, 1 = highly visible to user (Y axis). */
  visibility: number;
  description?: string;
}

interface Link {
  id: string;
  fromId: string;
  toId: string;
}

interface State {
  components: Component[];
  links: Link[];
}

const DEFAULT_STATE: State = { components: [], links: [] };

const STAGES = ["Genesis", "Custom", "Product", "Commodity"] as const;

function evolutionStage(e: number): (typeof STAGES)[number] {
  if (e < 0.25) return "Genesis";
  if (e < 0.5) return "Custom";
  if (e < 0.75) return "Product";
  return "Commodity";
}

function newId(): string {
  return crypto.randomUUID();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

interface NumDraftInputProps {
  value: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}

/**
 * 0-1 numeric input with string draft + commit-on-blur. Keeps NaN/partial
 * typing out of state.
 */
function NumDraftInput({ value, onCommit, ariaLabel }: NumDraftInputProps) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => {
    setDraft(value.toFixed(2));
  }, [value]);
  return (
    <Input
      type="number"
      min={0}
      max={1}
      step={0.05}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft);
        const next = Number.isFinite(parsed) ? clamp01(parsed) : value;
        onCommit(next);
        setDraft(next.toFixed(2));
      }}
      className="h-8 w-20 bg-bg border-border text-xs font-data"
      aria-label={ariaLabel}
    />
  );
}

// SVG canvas geometry constants. Compact ~300x250 plot area per spec.
const PAD_LEFT = 60;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const PLOT_W = 300;
const PLOT_H = 250;
const SVG_W = PAD_LEFT + PLOT_W + PAD_RIGHT;
const SVG_H = PAD_TOP + PLOT_H + PAD_BOTTOM;

// Map (visibility, evolution) ∈ [0,1]² to SVG coordinates. Visibility is
// inverted: 1 (visible to user) is at the top.
function toX(evolution: number): number {
  return PAD_LEFT + clamp01(evolution) * PLOT_W;
}
function toY(visibility: number): number {
  return PAD_TOP + (1 - clamp01(visibility)) * PLOT_H;
}

export function WardleyMapClient() {
  const [state, setState] = usePersisted<State>(
    "agile-toolkit:wardley-map",
    DEFAULT_STATE
  );
  const [draft, setDraft] = useState({
    name: "",
    evolution: "0.50",
    visibility: "0.50",
    description: "",
  });
  const [linkDraft, setLinkDraft] = useState({ fromId: "", toId: "" });
  const { log } = useHistoryLogger("wardley-map");

  const addComponent = () => {
    const name = draft.name.trim();
    if (!name) return;
    const evolution = clamp01(Number(draft.evolution) || 0.5);
    const visibility = clamp01(Number(draft.visibility) || 0.5);
    const description = draft.description.trim() || undefined;
    const c: Component = {
      id: newId(),
      name,
      evolution,
      visibility,
      description,
    };
    setState((s) => ({ ...s, components: [...s.components, c] }));
    log(WARDLEY_ACTIONS.COMPONENT_ADDED, {
      componentId: c.id,
      name: c.name,
      evolution: c.evolution,
      visibility: c.visibility,
      description,
    });
    setDraft({
      name: "",
      evolution: "0.50",
      visibility: "0.50",
      description: "",
    });
  };

  const removeComponent = (id: string) => {
    const c = state.components.find((x) => x.id === id);
    setState((s) => ({
      components: s.components.filter((x) => x.id !== id),
      // Drop any links that reference the deleted component.
      links: s.links.filter((l) => l.fromId !== id && l.toId !== id),
    }));
    log(WARDLEY_ACTIONS.COMPONENT_REMOVED, {
      componentId: id,
      name: c?.name,
    });
  };

  const moveComponent = (
    id: string,
    patch: { evolution?: number; visibility?: number }
  ) => {
    setState((s) => ({
      ...s,
      components: s.components.map((c) =>
        c.id === id
          ? {
              ...c,
              evolution: patch.evolution ?? c.evolution,
              visibility: patch.visibility ?? c.visibility,
            }
          : c
      ),
    }));
    log(WARDLEY_ACTIONS.COMPONENT_MOVED, {
      componentId: id,
      ...patch,
    });
  };

  const addLink = () => {
    const { fromId, toId } = linkDraft;
    if (!fromId || !toId || fromId === toId) return;
    if (
      state.links.some((l) => l.fromId === fromId && l.toId === toId)
    ) {
      return;
    }
    const l: Link = { id: newId(), fromId, toId };
    setState((s) => ({ ...s, links: [...s.links, l] }));
    log(WARDLEY_ACTIONS.LINK_ADDED, {
      linkId: l.id,
      fromId,
      toId,
    });
    setLinkDraft({ fromId: "", toId: "" });
  };

  const removeLink = (id: string) => {
    setState((s) => ({ ...s, links: s.links.filter((l) => l.id !== id) }));
    log(WARDLEY_ACTIONS.LINK_REMOVED, { linkId: id });
  };

  const validLinks = useMemo(() => {
    const ids = new Set(state.components.map((c) => c.id));
    return state.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
  }, [state.components, state.links]);

  const stats = useMemo(() => {
    const commodity = state.components.filter(
      (c) => c.evolution >= 0.75
    ).length;
    const avgEvo =
      state.components.length === 0
        ? 0
        : state.components.reduce((s, c) => s + c.evolution, 0) /
          state.components.length;
    return {
      total: state.components.length,
      commodity,
      avgEvo,
      links: validLinks.length,
    };
  }, [state.components, validLinks]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Wardley Map Canvas",
      prompts: generateWardleyMapPrompts({
        components: state.components,
        links: validLinks,
      }),
    }),
    [state.components, validLinks]
  );

  const componentById = (id: string) =>
    state.components.find((c) => c.id === id);

  return (
    <ToolPageWrapper
      toolId="wardley-map"
      title="Wardley Map Canvas"
      description="Plot components on visibility × evolution. Add links to draw the value chain. Use numeric inputs to position; quadrant guides show Genesis → Custom → Product → Commodity."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="wardley-map"
          csvData={{
            headers: [
              "Type",
              "Name / From",
              "To",
              "Evolution",
              "Visibility",
              "Stage",
              "Description",
            ],
            rows: [
              ...state.components.map(
                (c) =>
                  [
                    "component",
                    c.name,
                    "",
                    c.evolution.toFixed(2),
                    c.visibility.toFixed(2),
                    evolutionStage(c.evolution),
                    c.description ?? "",
                  ] as (string | number)[]
              ),
              ...validLinks.map(
                (l) =>
                  [
                    "link",
                    componentById(l.fromId)?.name ?? l.fromId,
                    componentById(l.toId)?.name ?? l.toId,
                    "",
                    "",
                    "",
                    "",
                  ] as (string | number)[]
              ),
            ],
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={MapIcon}
          label="Components"
          value={stats.total}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={GitBranch}
          label="Links"
          value={stats.links}
        />
        <StatCard
          variant="compact"
          label="Commodity"
          value={stats.commodity}
          hint="evolution ≥ 0.75"
        />
        <StatCard
          variant="compact"
          icon={TrendingUp}
          label="Avg evolution"
          value={stats.avgEvo.toFixed(2)}
        />
      </KpiGrid>

      {/* Canvas + add */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 mb-6">
        <Card className="bg-surface border-border">
          <CardContent className="p-3">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full max-w-[420px] h-auto"
              role="img"
              aria-label="Wardley map canvas"
            >
              {/* Background plot */}
              <rect
                x={PAD_LEFT}
                y={PAD_TOP}
                width={PLOT_W}
                height={PLOT_H}
                fill="var(--bg)"
                stroke="var(--border)"
              />

              {/* Quadrant guides — vertical evolution lines at 0.25/0.5/0.75 */}
              {[0.25, 0.5, 0.75].map((e) => (
                <line
                  key={`v-${e}`}
                  x1={toX(e)}
                  y1={PAD_TOP}
                  x2={toX(e)}
                  y2={PAD_TOP + PLOT_H}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
              ))}

              {/* Stage labels along bottom */}
              {STAGES.map((label, i) => {
                const cx = toX(i / 4 + 0.125);
                return (
                  <text
                    key={label}
                    x={cx}
                    y={PAD_TOP + PLOT_H + 14}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--sub)"
                  >
                    {label}
                  </text>
                );
              })}

              {/* X axis title */}
              <text
                x={PAD_LEFT + PLOT_W / 2}
                y={PAD_TOP + PLOT_H + 28}
                textAnchor="middle"
                fontSize={10}
                fill="var(--sub)"
                fontWeight="bold"
              >
                Evolution →
              </text>

              {/* Y axis title */}
              <text
                transform={`translate(14 ${PAD_TOP + PLOT_H / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize={10}
                fill="var(--sub)"
                fontWeight="bold"
              >
                Visibility ↑
              </text>
              <text
                x={PAD_LEFT - 6}
                y={PAD_TOP + 10}
                textAnchor="end"
                fontSize={9}
                fill="var(--sub)"
              >
                user
              </text>
              <text
                x={PAD_LEFT - 6}
                y={PAD_TOP + PLOT_H - 2}
                textAnchor="end"
                fontSize={9}
                fill="var(--sub)"
              >
                infra
              </text>

              {/* Links */}
              {validLinks.map((l) => {
                const from = componentById(l.fromId)!;
                const to = componentById(l.toId)!;
                return (
                  <line
                    key={l.id}
                    x1={toX(from.evolution)}
                    y1={toY(from.visibility)}
                    x2={toX(to.evolution)}
                    y2={toY(to.visibility)}
                    stroke="var(--accent)"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                  />
                );
              })}

              {/* Component dots + labels */}
              {state.components.map((c) => {
                const cx = toX(c.evolution);
                const cy = toY(c.visibility);
                return (
                  <g key={c.id}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill="var(--accent)"
                      stroke="var(--bg)"
                      strokeWidth={2}
                    />
                    <text
                      x={cx + 8}
                      y={cy + 3}
                      fontSize={10}
                      fill="var(--text)"
                    >
                      {c.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </CardContent>
        </Card>

        {/* Add-component form */}
        <Card className="bg-surface border-border">
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-semibold text-text">Add component</div>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addComponent()}
              placeholder="Component name"
              className="bg-bg border-border"
              aria-label="Component name"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-sub">
                  Evolution (0-1)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.evolution}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, evolution: e.target.value }))
                  }
                  onBlur={(e) => {
                    const v = clamp01(Number(e.target.value) || 0.5);
                    setDraft((d) => ({ ...d, evolution: v.toFixed(2) }));
                  }}
                  className="bg-bg border-border font-data"
                  aria-label="Evolution"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-sub">
                  Visibility (0-1)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.visibility}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, visibility: e.target.value }))
                  }
                  onBlur={(e) => {
                    const v = clamp01(Number(e.target.value) || 0.5);
                    setDraft((d) => ({ ...d, visibility: v.toFixed(2) }));
                  }}
                  className="bg-bg border-border font-data"
                  aria-label="Visibility"
                />
              </div>
            </div>
            <Textarea
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="Description (optional)..."
              rows={2}
              className="bg-bg border-border resize-none text-xs"
              aria-label="Description"
            />
            <Button
              onClick={addComponent}
              disabled={!draft.name.trim()}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-50 w-full"
            >
              <Plus className="w-4 h-4" />
              Add component
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Component list — edit position numerically */}
      {state.components.length > 0 && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-text mb-2">
              Components
            </div>
            <div className="space-y-2">
              {state.components.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-border bg-bg p-2"
                >
                  <div className="flex-1 min-w-[140px]">
                    <div className="text-sm text-text">{c.name}</div>
                    <div className="text-[10px] text-sub uppercase tracking-wider">
                      {evolutionStage(c.evolution)}
                    </div>
                    {c.description && (
                      <div className="text-[11px] text-sub mt-0.5 break-words">
                        {c.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-sub">
                      evo
                    </span>
                    <NumDraftInput
                      value={c.evolution}
                      onCommit={(n) => moveComponent(c.id, { evolution: n })}
                      ariaLabel="Evolution"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-sub">
                      vis
                    </span>
                    <NumDraftInput
                      value={c.visibility}
                      onCommit={(n) => moveComponent(c.id, { visibility: n })}
                      ariaLabel="Visibility"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeComponent(c.id)}
                    className="text-sub hover:text-danger h-6 w-6 p-0"
                    aria-label={`Remove ${c.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add link */}
      {state.components.length >= 2 && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-semibold text-text">Add link</div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
              <Select
                value={linkDraft.fromId || undefined}
                onValueChange={(v) =>
                  setLinkDraft((p) => ({ ...p, fromId: v }))
                }
              >
                <SelectTrigger
                  className="bg-bg border-border"
                  aria-label="From component"
                >
                  <SelectValue placeholder="From..." />
                </SelectTrigger>
                <SelectContent>
                  {state.components.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={linkDraft.toId || undefined}
                onValueChange={(v) =>
                  setLinkDraft((p) => ({ ...p, toId: v }))
                }
              >
                <SelectTrigger
                  className="bg-bg border-border"
                  aria-label="To component"
                >
                  <SelectValue placeholder="To..." />
                </SelectTrigger>
                <SelectContent>
                  {state.components.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={addLink}
                disabled={
                  !linkDraft.fromId ||
                  !linkDraft.toId ||
                  linkDraft.fromId === linkDraft.toId
                }
                className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Link
              </Button>
            </div>
            {validLinks.length > 0 && (
              <div className="space-y-1 pt-2">
                {validLinks.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 text-xs text-text"
                  >
                    <span>
                      {componentById(l.fromId)?.name} →{" "}
                      {componentById(l.toId)?.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLink(l.id)}
                      className="text-sub hover:text-danger h-5 w-5 p-0 ml-auto"
                      aria-label="Remove link"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </ToolPageWrapper>
  );
}
