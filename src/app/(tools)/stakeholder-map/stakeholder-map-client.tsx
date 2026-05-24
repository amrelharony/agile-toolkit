"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, PieChart, Users, AlertOctagon } from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { STAKEHOLDER_MAP_ACTIONS } from "@/lib/history/event-actions";
import { generateStakeholderMapPrompts } from "@/lib/ai-prompts/stakeholder-map";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type Sentiment = "champion" | "supporter" | "neutral" | "skeptic" | "blocker";

interface Stakeholder {
  id: string;
  name: string;
  role?: string;
  interest: number; // 0-10
  authority: number; // 0-10
  sentiment: Sentiment;
  strategy?: string;
  description?: string;
}

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  champion: "Champion",
  supporter: "Supporter",
  neutral: "Neutral",
  skeptic: "Skeptic",
  blocker: "Blocker",
};

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  champion: "#10b981",
  supporter: "#34d399",
  neutral: "#94a3b8",
  skeptic: "#f59e0b",
  blocker: "#ef4444",
};

type Quadrant = "manageClosely" | "keepSatisfied" | "keepInformed" | "monitor";

const QUADRANT_LABEL: Record<Quadrant, string> = {
  manageClosely: "Manage Closely",
  keepSatisfied: "Keep Satisfied",
  keepInformed: "Keep Informed",
  monitor: "Monitor",
};

const QUADRANT_DESCRIPTION: Record<Quadrant, string> = {
  manageClosely: "High authority + high interest. Engage frequently, co-create plans.",
  keepSatisfied: "High authority + low interest. Brief succinctly, avoid surprises.",
  keepInformed: "Low authority + high interest. Share progress, harness for advocacy.",
  monitor: "Low authority + low interest. Light touch, watch for shifts.",
};

function quadrantOf(s: Stakeholder): Quadrant {
  const highInterest = s.interest >= 5;
  const highAuthority = s.authority >= 5;
  if (highAuthority && highInterest) return "manageClosely";
  if (highAuthority && !highInterest) return "keepSatisfied";
  if (!highAuthority && highInterest) return "keepInformed";
  return "monitor";
}

interface InlineDescriptionEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

/**
 * R-INLINE-LOG editor for the per-row description Textarea.
 *
 * `updateStakeholder` logs unconditionally, so binding the Textarea to it
 * via `onChange` would emit one history event per keystroke. We keep a local
 * draft string, write back to the parent only on blur, and only when the
 * trimmed value actually differs from what the parent committed last.
 */
function InlineDescriptionEditor({ value, onChange, placeholder }: InlineDescriptionEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const lastCommittedRef = useRef(value);
  useEffect(() => {
    if (document.activeElement === taRef.current) return;
    if (value === lastCommittedRef.current) return;
    setDraft(value);
    lastCommittedRef.current = value;
  }, [value]);
  return (
    <Textarea
      ref={taRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === lastCommittedRef.current) return;
        lastCommittedRef.current = draft;
        onChange(draft);
      }}
      placeholder={placeholder}
      rows={2}
      className="bg-bg border-border text-xs resize-none"
      aria-label="Description"
    />
  );
}

interface StakeholderFormProps {
  onAdd: (s: Stakeholder) => void;
}

function StakeholderForm({ onAdd }: StakeholderFormProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [interest, setInterest] = useState(5);
  const [authority, setAuthority] = useState(5);
  const [sentiment, setSentiment] = useState<Sentiment>("neutral");
  const [strategy, setStrategy] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({
      id: crypto.randomUUID(),
      name: trimmed,
      role: role.trim() || undefined,
      interest,
      authority,
      sentiment,
      strategy: strategy.trim() || undefined,
      description: description.trim() || undefined,
    });
    setName("");
    setRole("");
    setInterest(5);
    setAuthority(5);
    setSentiment("neutral");
    setStrategy("");
    setDescription("");
  };

  return (
    <Card className="bg-surface border-border mb-4">
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-sub">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VP of Marketing"
              className="bg-bg border-border"
              aria-label="Stakeholder name"
            />
          </div>
          <div>
            <Label className="text-xs text-sub">Role</Label>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Sponsor / Customer / Exec..."
              className="bg-bg border-border"
              aria-label="Role"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-sub">Interest</Label>
              <span className="text-xs font-data text-text">{interest}/10</span>
            </div>
            <Slider
              min={0}
              max={10}
              step={1}
              value={[interest]}
              onValueChange={(v) => setInterest(v[0] ?? 0)}
              className="mt-2"
              aria-label="Interest level"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-sub">Authority</Label>
              <span className="text-xs font-data text-text">{authority}/10</span>
            </div>
            <Slider
              min={0}
              max={10}
              step={1}
              value={[authority]}
              onValueChange={(v) => setAuthority(v[0] ?? 0)}
              className="mt-2"
              aria-label="Authority level"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs text-sub">Sentiment</Label>
          <Select value={sentiment} onValueChange={(v) => setSentiment(v as Sentiment)}>
            <SelectTrigger className="bg-bg border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["champion", "supporter", "neutral", "skeptic", "blocker"] as Sentiment[]).map(
                (s) => (
                  <SelectItem key={s} value={s}>
                    {SENTIMENT_LABEL[s]}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-sub">Engagement strategy</Label>
          <Textarea
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            placeholder="What's the plan? Who owns the relationship?"
            rows={2}
            className="bg-bg border-border resize-none text-sm"
            aria-label="Engagement strategy"
          />
        </div>
        <div>
          <Label className="text-xs text-sub">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="Description"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} className="gap-2 bg-accent text-bg hover:bg-accent/90">
            <Plus className="w-4 h-4" />
            Add stakeholder
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function StakeholderMapClient() {
  const [stakeholders, setStakeholders] = usePersisted<Stakeholder[]>(
    "agile-toolkit:stakeholder-map",
    []
  );
  const { log } = useHistoryLogger("stakeholder-map");
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

  // Tooltip on the matrix.
  const [hovered, setHovered] = useState<string | null>(null);

  const addStakeholder = (s: Stakeholder) => {
    setStakeholders((prev) => [s, ...prev]);
    log(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_ADDED, {
      stakeholderId: s.id,
      name: s.name,
      sentiment: s.sentiment,
    });
  };

  const removeStakeholder = (id: string) => {
    const s = stakeholders.find((x) => x.id === id);
    setStakeholders((prev) => prev.filter((x) => x.id !== id));
    // The matrix tooltip stays anchored to a removed dot until another
    // hover/focus replaces it — clear it so it doesn't dangle.
    setHovered((cur) => (cur === id ? null : cur));
    log(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_REMOVED, {
      stakeholderId: id,
      name: s?.name,
    });
  };

  // R11-fix: split logged vs quiet update. The previous unconditional
  // log fired one history event PER KEYSTROKE when bound to Input
  // onChange — typing "Engineering Director" in `role` would emit 20+
  // STAKEHOLDER_UPDATED events. R-INLINE-LOG had been applied only to
  // the description Textarea (via InlineDescriptionEditor); the name,
  // role, and strategy fields still log-spammed. Now: onChange uses
  // the quiet path (state-only), onBlur uses the logged path
  // (committed value with single event).
  const updateStakeholderQuiet = (id: string, patch: Partial<Stakeholder>) => {
    setStakeholders((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const updateStakeholder = (id: string, patch: Partial<Stakeholder>) => {
    updateStakeholderQuiet(id, patch);
    log(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_UPDATED, {
      stakeholderId: id,
      fields: Object.keys(patch),
    });
  };

  // Esc clears hover so the tooltip doesn't get stuck on touch devices.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHovered(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quadrants = useMemo(() => {
    const out: Record<Quadrant, Stakeholder[]> = {
      manageClosely: [],
      keepSatisfied: [],
      keepInformed: [],
      monitor: [],
    };
    for (const s of stakeholders) out[quadrantOf(s)].push(s);
    return out;
  }, [stakeholders]);

  const sentimentCounts = useMemo(() => {
    const c: Record<Sentiment, number> = {
      champion: 0,
      supporter: 0,
      neutral: 0,
      skeptic: 0,
      blocker: 0,
    };
    for (const s of stakeholders) c[s.sentiment] += 1;
    return c;
  }, [stakeholders]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Stakeholder Map",
      prompts: generateStakeholderMapPrompts(
        {
          stakeholders: stakeholders.map((s) => ({
            name: s.name,
            role: s.role,
            interest: s.interest,
            authority: s.authority,
            sentiment: s.sentiment,
            strategy: s.strategy,
            description: s.description,
          })),
          quadrants: {
            manageClosely: quadrants.manageClosely.length,
            keepSatisfied: quadrants.keepSatisfied.length,
            keepInformed: quadrants.keepInformed.length,
            monitor: quadrants.monitor.length,
          },
          blockers: sentimentCounts.blocker,
        },
        workspace
      ),
    }),
    [stakeholders, quadrants, sentimentCounts, workspace]
  );

  const hoveredStakeholder = hovered ? (stakeholders.find((s) => s.id === hovered) ?? null) : null;

  return (
    <ToolPageWrapper
      toolId="stakeholder-map"
      title="Stakeholder Map"
      description="Map stakeholders by Interest × Authority and pick an engagement strategy per quadrant."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="stakeholder-map"
          csvData={{
            headers: [
              "Name",
              "Role",
              "Interest",
              "Authority",
              "Sentiment",
              "Quadrant",
              "Strategy",
              "Description",
            ],
            rows: stakeholders.map((s) => [
              s.name,
              s.role ?? "",
              s.interest,
              s.authority,
              s.sentiment,
              QUADRANT_LABEL[quadrantOf(s)],
              s.strategy ?? "",
              s.description ?? "",
            ]),
          }}
          jsonData={stakeholders}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Users}
          label="Total"
          value={stakeholders.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={PieChart}
          label="Manage Closely"
          value={quadrants.manageClosely.length}
        />
        <StatCard
          variant="compact"
          icon={AlertOctagon}
          label="Blockers"
          value={sentimentCounts.blocker}
          tone={sentimentCounts.blocker > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          label="Champions"
          value={sentimentCounts.champion}
          valueClassName="text-emerald-300"
        />
      </KpiGrid>

      <StakeholderForm onAdd={addStakeholder} />

      {stakeholders.length === 0 ? (
        <EmptyState icon={PieChart}>
          No stakeholders mapped yet. Add your first one above to see the matrix fill in.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 mb-6">
            {/* Matrix */}
            <Card className="bg-surface border-border">
              <CardContent className="p-4">
                <div className="text-sm font-semibold text-text mb-3">Interest × Authority</div>
                <div className="relative aspect-square w-full max-w-xl mx-auto">
                  {/* Quadrant background grid */}
                  <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-border rounded-lg overflow-hidden">
                    {/* top-left = high authority + low interest = Keep Satisfied */}
                    <div className="bg-amber-500/5 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-amber-300/70">
                        Keep Satisfied
                      </div>
                    </div>
                    {/* top-right = high authority + high interest = Manage Closely */}
                    <div className="bg-accent/10 p-2 text-right">
                      <div className="text-[10px] uppercase tracking-wider text-accent/70">
                        Manage Closely
                      </div>
                    </div>
                    {/* bottom-left = low authority + low interest = Monitor */}
                    <div className="bg-bg p-2">
                      <div className="text-[10px] uppercase tracking-wider text-sub">Monitor</div>
                    </div>
                    {/* bottom-right = low authority + high interest = Keep Informed */}
                    <div className="bg-emerald-500/5 p-2 text-right">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-300/70">
                        Keep Informed
                      </div>
                    </div>
                  </div>

                  {/* Axis labels */}
                  <div
                    className="absolute -left-6 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-wider text-sub"
                    aria-hidden
                  >
                    Authority →
                  </div>
                  <div
                    className="absolute left-1/2 -bottom-6 -translate-x-1/2 text-[10px] uppercase tracking-wider text-sub"
                    aria-hidden
                  >
                    Interest →
                  </div>

                  {/* Dots */}
                  {stakeholders.map((s) => {
                    // Map (interest, authority) ∈ [0,10] to (left%, top%)
                    // Authority=10 should be at the top, so invert Y.
                    // Clamp to [4, 96]% so the 16 px dot doesn't get clipped
                    // at the matrix corners (interest=0 or authority=10).
                    const rawLeft = (s.interest / 10) * 100;
                    const rawTop = 100 - (s.authority / 10) * 100;
                    const left = Math.min(96, Math.max(4, rawLeft));
                    const top = Math.min(96, Math.max(4, rawTop));
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-bg shadow-md transition hover:scale-125 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          background: SENTIMENT_COLOR[s.sentiment],
                        }}
                        onMouseEnter={() => setHovered(s.id)}
                        onMouseLeave={() => setHovered((cur) => (cur === s.id ? null : cur))}
                        onFocus={() => setHovered(s.id)}
                        onBlur={() => setHovered((cur) => (cur === s.id ? null : cur))}
                        aria-label={`${s.name}${s.role ? ", " + s.role : ""}`}
                      />
                    );
                  })}

                  {/* Tooltip */}
                  {hoveredStakeholder && (
                    <div
                      className="absolute top-2 right-2 max-w-[60%] rounded-md border border-border bg-bg p-2 text-xs shadow-lg pointer-events-none"
                      role="tooltip"
                    >
                      <div className="font-semibold text-text">{hoveredStakeholder.name}</div>
                      {hoveredStakeholder.role && (
                        <div className="text-sub mt-0.5">{hoveredStakeholder.role}</div>
                      )}
                      <div className="text-sub mt-0.5">
                        Int {hoveredStakeholder.interest} · Auth {hoveredStakeholder.authority} ·{" "}
                        {SENTIMENT_LABEL[hoveredStakeholder.sentiment]}
                      </div>
                    </div>
                  )}
                </div>

                {/* Legend */}
                <div className="mt-8 flex flex-wrap gap-3 justify-center text-xs">
                  {(["champion", "supporter", "neutral", "skeptic", "blocker"] as Sentiment[]).map(
                    (s) => (
                      <span key={s} className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-full border border-bg"
                          style={{ background: SENTIMENT_COLOR[s] }}
                        />
                        {SENTIMENT_LABEL[s]}
                      </span>
                    )
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quadrant strategy summary */}
            <div className="space-y-2">
              {(["manageClosely", "keepSatisfied", "keepInformed", "monitor"] as Quadrant[]).map(
                (q) => (
                  <Card key={q} className="bg-surface border-border">
                    <CardContent className="p-3">
                      <div className="text-xs uppercase tracking-wider text-sub">
                        {QUADRANT_LABEL[q]}
                      </div>
                      <div className="text-sm font-data text-text mt-0.5">
                        {quadrants[q].length} stakeholder
                        {quadrants[q].length === 1 ? "" : "s"}
                      </div>
                      <div className="text-xs text-sub mt-1">{QUADRANT_DESCRIPTION[q]}</div>
                      {quadrants[q].length > 0 && (
                        <div className="text-xs text-text mt-2 truncate">
                          {quadrants[q].map((s) => s.name).join(", ")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              )}
            </div>
          </div>

          {/* Editable list */}
          <div className="space-y-2">
            {stakeholders.map((s) => (
              <Card key={s.id} className="bg-surface border-border">
                <CardContent className="p-3 space-y-2">
                  <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <BlurInput
                        value={s.name}
                        onCommit={(v) => updateStakeholder(s.id, { name: v })}
                        className="bg-bg border-border font-semibold"
                        aria-label="Name"
                      />
                      <BlurInput
                        value={s.role ?? ""}
                        onCommit={(v) => updateStakeholder(s.id, { role: v.trim() || undefined })}
                        placeholder="Role (optional)"
                        className="bg-bg border-border mt-1 text-xs"
                        aria-label="Role"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={s.sentiment}
                        onValueChange={(v) =>
                          updateStakeholder(s.id, {
                            sentiment: v as Sentiment,
                          })
                        }
                      >
                        <SelectTrigger
                          className="bg-bg border-border h-8 text-xs w-32"
                          aria-label={`Sentiment for ${s.name}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            [
                              "champion",
                              "supporter",
                              "neutral",
                              "skeptic",
                              "blocker",
                            ] as Sentiment[]
                          ).map((sk) => (
                            <SelectItem key={sk} value={sk} className="text-xs">
                              {SENTIMENT_LABEL[sk]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStakeholder(s.id)}
                        className="text-sub hover:text-danger"
                        aria-label={`Remove ${s.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-sub">Interest</Label>
                        <span className="text-xs font-data text-text">{s.interest}/10</span>
                      </div>
                      <Slider
                        min={0}
                        max={10}
                        step={1}
                        value={[s.interest]}
                        // BUG-T8-stakeholder-map-1: quiet update per
                        // drag tick (no history log); commit ONE logged
                        // event on release. The prior pattern emitted
                        // STAKEHOLDER_UPDATED for every intermediate
                        // value during a drag, spamming the history store.
                        onValueChange={(v) => updateStakeholderQuiet(s.id, { interest: v[0] ?? 0 })}
                        onValueCommit={(v) => updateStakeholder(s.id, { interest: v[0] ?? 0 })}
                        className="mt-2"
                        aria-label={`Interest for ${s.name}`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-sub">Authority</Label>
                        <span className="text-xs font-data text-text">{s.authority}/10</span>
                      </div>
                      <Slider
                        min={0}
                        max={10}
                        step={1}
                        value={[s.authority]}
                        onValueChange={(v) =>
                          updateStakeholderQuiet(s.id, { authority: v[0] ?? 0 })
                        }
                        onValueCommit={(v) => updateStakeholder(s.id, { authority: v[0] ?? 0 })}
                        className="mt-2"
                        aria-label={`Authority for ${s.name}`}
                      />
                    </div>
                  </div>
                  <BlurTextarea
                    value={s.strategy ?? ""}
                    onCommit={(v) => updateStakeholder(s.id, { strategy: v.trim() || undefined })}
                    placeholder="Engagement strategy..."
                    rows={2}
                    className="bg-bg border-border text-sm resize-none"
                    aria-label="Strategy"
                  />
                  <InlineDescriptionEditor
                    value={s.description ?? ""}
                    onChange={(next) =>
                      updateStakeholder(s.id, {
                        description: next.trim() || undefined,
                      })
                    }
                    placeholder="Description (optional)..."
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </ToolPageWrapper>
  );
}
