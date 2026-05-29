"use client";

import { useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, Clock, Users, Heart, Sparkles } from "lucide-react";
import { generateLiberatingStructuresPrompts } from "@/lib/ai-prompts/liberating-structures";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { LIBERATING_STRUCTURES_ACTIONS } from "@/lib/history/event-actions";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type GroupSize = "small (2-7)" | "medium (8-30)" | "large (30+)";
type TimingBucket = "under 15 min" | "15-30 min" | "30+ min";

interface CatalogEntry {
  id: string;
  name: string;
  purpose: string;
  /** Human label (e.g. "20 min", "60 min") used as the displayed timing. */
  timing: string;
  /** Numeric minutes used for bucket filtering. */
  timingMinutes: number;
  groupSize: GroupSize;
  description: string;
  source: string;
}

interface Favorite {
  id: string;
  structureId: string;
  ts: string;
}

interface State {
  favorites: Favorite[];
}

const DEFAULT_STATE: State = { favorites: [] };

const LS_ID = "liberatingStructures:current"; // MUST match LS_ID in liberating-structures.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// writes round-trip into the UI. Drop-in [state, setState] (structural types).
function useLiberatingStructures(): [State, (u: State | ((p: State) => State)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.liberatingStructures ?? []).find((d) => d.id === LS_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertLiberatingStructures);
  const state: State = doc ? { favorites: doc.favorites } : DEFAULT_STATE;
  const setState = (u: State | ((p: State) => State)) => {
    const cur = (useWorkspaceStore.getState().liberatingStructures ?? []).find(
      (d) => d.id === LS_ID
    );
    const curState: State = cur ? { favorites: cur.favorites } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: LS_ID, favorites: next.favorites });
  };
  return [state, setState];
}

const CATALOG: CatalogEntry[] = [
  {
    id: "ls-1-2-4-all",
    name: "1-2-4-All",
    purpose: "Engage everyone simultaneously in generating questions, ideas, and suggestions",
    timing: "12-15 min",
    timingMinutes: 13,
    groupSize: "medium (8-30)",
    description:
      "Silent reflection (1 min) → pairs (2 min) → quartets (4 min) → whole group (5 min). Ensures everyone speaks before the loud voices anchor the room.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-impromptu",
    name: "Impromptu Networking",
    purpose: "Rapidly share challenges and expectations, build connections",
    timing: "15-20 min",
    timingMinutes: 18,
    groupSize: "medium (8-30)",
    description:
      "Three rounds of 2-minute paired conversations on a focused question. Standing up. Great as an opener that breaks cliques.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-9-whys",
    name: "9 Whys",
    purpose: "Make the purpose of work together clear",
    timing: "20 min",
    timingMinutes: 20,
    groupSize: "small (2-7)",
    description:
      "Pairs ask each other 'Why is that important to you?' up to 9 times. Surfaces the deepest motivation behind a goal in a way other framings miss.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-wise-crowds",
    name: "Wise Crowds",
    purpose: "Tap the wisdom of the whole group in rapid cycles",
    timing: "15-25 min per round",
    timingMinutes: 25,
    groupSize: "small (2-7)",
    description:
      "A client presents a challenge for 2 min, the group asks clarifying questions, the client turns their back, and the group discusses while the client listens, then the client reflects.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-25-10",
    name: "25/10 Crowd Sourcing",
    purpose: "Quickly surface and prioritize the group's boldest ideas",
    timing: "30 min",
    timingMinutes: 30,
    groupSize: "large (30+)",
    description:
      "Each person writes their boldest idea on a card, then 5 rounds of swap-and-rate (1-5). Top-rated ideas surface without the loudest-voice bias of open discussion.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-troika",
    name: "Troika Consulting",
    purpose: "Get practical and imaginative help from peers immediately",
    timing: "30 min",
    timingMinutes: 30,
    groupSize: "small (2-7)",
    description:
      "Trios; each person gets 7-10 min as 'client'. Client describes the challenge (1-2 min), turns away, and consultants discuss while client listens, then client reflects on what was useful.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-winfy",
    name: "What I Need From You (WINFY)",
    purpose: "Surface essential requests across functions to clear blockers",
    timing: "55-70 min",
    timingMinutes: 60,
    groupSize: "medium (8-30)",
    description:
      "Each function makes 2-3 specific 'what I need from you' requests of each other function. Requests are then answered with yes / no / whatever / I'll try, with no negotiation in the moment.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-dad",
    name: "Discovery & Action Dialogue (DAD)",
    purpose: "Discover, invent, and unleash local solutions to chronic problems",
    timing: "25-70 min",
    timingMinutes: 50,
    groupSize: "medium (8-30)",
    description:
      "A 7-question protocol that draws out 'positive deviants' — people already solving the problem — and invites the group to invent next steps together.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-ecocycle",
    name: "Ecocycle Planning",
    purpose: "Analyze the full portfolio of activities to identify obstacles and opportunities",
    timing: "60-95 min",
    timingMinutes: 75,
    groupSize: "medium (8-30)",
    description:
      "Map every activity onto a 4-stage ecocycle (birth, maturity, creative destruction, renewal). Surfaces 'rigidity traps' (doing too much) and 'poverty traps' (starving the new).",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-cafe",
    name: "Conversation Café",
    purpose: "Engage everyone in making sense of profound challenges",
    timing: "60-90 min",
    timingMinutes: 75,
    groupSize: "large (30+)",
    description:
      "Tables of 5-7 hold rounds of conversation guided by 6 agreements (e.g. 'speak with intention'). Two rounds with a talking object then open dialogue.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-triz",
    name: "TRIZ",
    purpose: "Make space for innovation by stopping counterproductive activities",
    timing: "35 min",
    timingMinutes: 35,
    groupSize: "medium (8-30)",
    description:
      "Three rounds: (1) make a list of how to achieve the worst possible result, (2) match items to what you currently do, (3) decide what to stop doing.",
    source: "liberatingstructures.com",
  },
  {
    id: "ls-open-space",
    name: "Open Space Technology",
    purpose: "Liberate inherent action and leadership in large groups",
    timing: "90 min – 3 days",
    timingMinutes: 180,
    groupSize: "large (30+)",
    description:
      "Participants self-organize sessions around a single overarching question. Governed by the Law of Two Feet: if you're not learning or contributing, move.",
    source: "liberatingstructures.com",
  },
];

const GROUP_SIZES: GroupSize[] = ["small (2-7)", "medium (8-30)", "large (30+)"];
const TIMING_BUCKETS: TimingBucket[] = ["under 15 min", "15-30 min", "30+ min"];

function bucketFor(min: number): TimingBucket {
  if (min < 15) return "under 15 min";
  if (min <= 30) return "15-30 min";
  return "30+ min";
}

function newId(): string {
  return crypto.randomUUID();
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
        active
          ? "bg-accent/15 text-accent border-accent/60"
          : "bg-surface text-sub border-border hover:border-accent/30 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

export function LiberatingStructuresClient() {
  const [state, setState] = useLiberatingStructures();
  const [groupFilter, setGroupFilter] = useState<GroupSize | "all">("all");
  const [timingFilter, setTimingFilter] = useState<TimingBucket | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { log } = useHistoryLogger("liberating-structures");

  const favSet = useMemo(
    // Filter out malformed entries (missing/null structureId) so a corrupt
    // persisted payload doesn't end up with `Set(undefined)` — that masked
    // the favorited-state of every card whose id happens to match the
    // implicit `undefined` lookup.
    () =>
      new Set(
        state.favorites
          .map((f) => f?.structureId)
          .filter((id): id is string => typeof id === "string")
      ),
    [state.favorites]
  );

  const toggleFavorite = (structureId: string) => {
    const isFav = favSet.has(structureId);
    setState((s) => ({
      favorites: isFav
        ? s.favorites.filter((f) => f.structureId !== structureId)
        : [...s.favorites, { id: newId(), structureId, ts: new Date().toISOString() }],
    }));
    log(LIBERATING_STRUCTURES_ACTIONS.STRUCTURE_FAVORITED, {
      structureId,
      action: isFav ? "removed" : "added",
    });
  };

  const handleExpand = (id: string) => {
    // Compute the next state up-front so we can decide whether to log without
    // racing the (asynchronous) `expandedId` update from the previous click.
    const nextExpanded = expandedId === id ? null : id;
    setExpandedId(nextExpanded);
    if (nextExpanded !== null) {
      log(LIBERATING_STRUCTURES_ACTIONS.STRUCTURE_VIEWED, { structureId: id });
    }
  };

  const filtered = useMemo(() => {
    return CATALOG.filter((s) => {
      if (groupFilter !== "all" && s.groupSize !== groupFilter) return false;
      if (timingFilter !== "all" && bucketFor(s.timingMinutes) !== timingFilter) return false;
      return true;
    });
  }, [groupFilter, timingFilter]);

  const favoriteEntries = useMemo(
    () =>
      state.favorites
        .map((f) => CATALOG.find((c) => c.id === f.structureId))
        .filter((c): c is CatalogEntry => Boolean(c)),
    [state.favorites]
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

  const promptConfig = useMemo(
    () => ({
      toolName: "Liberating Structures Picker",
      prompts: generateLiberatingStructuresPrompts(
        {
          catalog: CATALOG,
          favoriteIds: state.favorites.map((f) => f.structureId),
        },
        workspace
      ),
    }),
    [state.favorites, workspace]
  );

  const handleGroupFilter = (g: GroupSize | "all") => {
    setGroupFilter(g);
    log(LIBERATING_STRUCTURES_ACTIONS.FILTER_CHANGED, { groupSize: g });
  };

  const handleTimingFilter = (t: TimingBucket | "all") => {
    setTimingFilter(t);
    log(LIBERATING_STRUCTURES_ACTIONS.FILTER_CHANGED, { timing: t });
  };

  return (
    <ToolPageWrapper
      toolId="liberating-structures"
      title="Liberating Structures Picker"
      description="Twelve high-leverage micro-structures from Liberating Structures. Filter by group size and timing, click a card for details, save favorites for your next workshop."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="liberating-structures-favorites"
          csvData={{
            headers: ["Name", "Purpose", "Timing", "Group Size", "Source", "Description"],
            rows: favoriteEntries.map((s) => [
              s.name,
              s.purpose,
              s.timing,
              s.groupSize,
              s.source,
              s.description,
            ]),
          }}
          jsonData={{ favorites: favoriteEntries }}
        />
      </ActionRow>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          icon={Sparkles}
          label="Catalog"
          value={CATALOG.length}
          hint="structures"
          valueClassName="text-accent"
        />
        <StatCard variant="compact" icon={Heart} label="Favorites" value={state.favorites.length} />
        <StatCard variant="compact" label="Showing" value={filtered.length} hint="match filters" />
      </KpiGrid>

      {/* Filters */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-sub font-semibold">
              <Users className="w-3.5 h-3.5" />
              Group size
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                label="All"
                active={groupFilter === "all"}
                onClick={() => handleGroupFilter("all")}
              />
              {GROUP_SIZES.map((g) => (
                <FilterChip
                  key={g}
                  label={g}
                  active={groupFilter === g}
                  onClick={() => handleGroupFilter(g)}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-sub font-semibold">
              <Clock className="w-3.5 h-3.5" />
              Timing
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                label="All"
                active={timingFilter === "all"}
                onClick={() => handleTimingFilter("all")}
              />
              {TIMING_BUCKETS.map((t) => (
                <FilterChip
                  key={t}
                  label={t}
                  active={timingFilter === t}
                  onClick={() => handleTimingFilter(t)}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Favorites strip */}
      {favoriteEntries.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text">Your favorites</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {favoriteEntries.map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                className="bg-accent/10 border-accent/40 text-accent text-xs px-3 py-1"
              >
                {s.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Card grid */}
      {filtered.length === 0 ? (
        <Card className="bg-surface border-border">
          <CardContent className="p-8 text-center text-sub text-sm">
            No structures match your current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => {
            const isFav = favSet.has(s.id);
            const isExpanded = expandedId === s.id;
            return (
              <Card
                key={s.id}
                className={`bg-surface border-border transition cursor-pointer ${
                  isExpanded ? "border-accent/40" : "hover:border-accent/30"
                }`}
                onClick={() => handleExpand(s.id)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-text">{s.name}</div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(s.id);
                      }}
                      aria-label={isFav ? "Remove favorite" : "Add favorite"}
                      className="shrink-0 p-1 -m-1 min-touch-coarse inline-flex items-center justify-center"
                    >
                      <Heart
                        className={`w-4 h-4 transition ${
                          isFav ? "fill-accent text-accent" : "text-sub hover:text-accent"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="text-xs text-sub line-clamp-2">{s.purpose}</div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge variant="outline" className="text-[10px] bg-bg border-border text-sub">
                      <Clock className="w-3 h-3 mr-0.5" />
                      {s.timing}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-bg border-border text-sub">
                      <Users className="w-3 h-3 mr-0.5" />
                      {s.groupSize}
                    </Badge>
                  </div>
                  {isExpanded && (
                    <div className="pt-2 border-t border-border space-y-2">
                      <p className="text-xs text-text leading-relaxed">{s.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-sub">Source: {s.source}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(s.id);
                          }}
                          className="gap-1.5 text-xs"
                        >
                          <Heart
                            className={`w-3.5 h-3.5 ${isFav ? "fill-accent text-accent" : ""}`}
                          />
                          {isFav ? "Saved" : "Save"}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </ToolPageWrapper>
  );
}
