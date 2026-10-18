"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Shuffle, Clock, Users, Zap, Tag, Star } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ICEBREAKER_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { icebreakers, type IceBreaker } from "@/lib/constants/icebreakers";

// ── Types ───────────────────────────────────────────────────
type TimeFilter = "all" | 2 | 5 | 10 | 15;
type SizeFilter = "all" | "small" | "medium" | "large";
type EnergyFilter = "all" | "low" | "medium" | "high";
type CategoryFilter = "all" | "question" | "activity" | "game" | "creative" | "agile";

// Namespace under `agile-toolkit:` like every other persisted store so it
// shows up in the same group when teams audit/inspect their localStorage.
// Read from the legacy unprefixed key once for backward-compat.
const FAVORITES_KEY = "agile-toolkit:icebreaker-favorites";
const LEGACY_FAVORITES_KEY = "icebreaker-favorites";

// ── Helpers ─────────────────────────────────────────────────
function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const fresh = localStorage.getItem(FAVORITES_KEY);
    const legacy = localStorage.getItem(LEGACY_FAVORITES_KEY);
    const raw = fresh ?? legacy;
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const set = new Set(parsed.filter((v): v is string => typeof v === "string"));
    // BUG-T4-icebreaker-2: migrate the legacy key on first read so we
    // don't keep tripping over a stale copy. Write the canonical key
    // and delete the legacy one in one shot.
    if (!fresh && legacy) {
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
        localStorage.removeItem(LEGACY_FAVORITES_KEY);
      } catch {
        /* quota / private mode — keep the in-memory set */
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

function saveFavorites(ids: Set<string>) {
  // localStorage can throw (quota exceeded, disabled, private mode). Match
  // loadFavorites' resilience and don't crash the toggle handler — just
  // log so the failure isn't fully silent during dev.
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Quota exceeded, disabled, or private mode — drop silently. Favorites
    // are a convenience layer; the next render reads the in-memory set.
  }
}

const sizeLabel: Record<IceBreaker["teamSize"], string> = {
  small: "2-5",
  medium: "5-10",
  large: "10+",
};

const energyColors: Record<IceBreaker["energyLevel"], string> = {
  low: "bg-accent-green/20 text-accent-green border-accent-green/30",
  medium: "bg-accent-amber/20 text-accent-amber border-accent-amber/30",
  high: "bg-status-red/20 text-status-red border-status-red/30",
};

const categoryColors: Record<IceBreaker["category"], string> = {
  question: "bg-accent-cyan/20 text-accent border-accent-cyan/30",
  activity: "bg-accent-green/20 text-accent-green border-accent-green/30",
  game: "bg-accent-magenta/20 text-accent-magenta border-accent-magenta/30",
  creative: "bg-accent-amber/20 text-accent-amber border-accent-amber/30",
  agile: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

// ── Filter Chip ─────────────────────────────────────────────
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-touch-coarse inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border ${
        active
          ? "bg-accent-cyan/20 text-accent border-accent-cyan shadow-neon-cyan"
          : "bg-card text-sub border-border hover:border-border hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

// ── Icebreaker Card (grid item) ─────────────────────────────
function IceBreakerCard({
  icebreaker,
  isFavorite,
  onToggleFavorite,
  onSelect,
}: {
  icebreaker: IceBreaker;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onSelect: (ib: IceBreaker) => void;
}) {
  return (
    // The title is the card's button; its ::after stretches over the whole
    // card so the card stays clickable, while the favourite toggle sits above
    // it (a clickable <Card> div was mouse-only, and a button can't contain
    // the favourite button).
    <Card className="relative bg-card border-border hover:border-accent-cyan/30 transition-all duration-200 cursor-pointer group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-text group-hover:text-accent transition-colors">
            <button
              type="button"
              onClick={() => onSelect(icebreaker)}
              className="text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
            >
              {icebreaker.name}
            </button>
          </CardTitle>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(icebreaker.id);
            }}
            aria-label={`${isFavorite ? "Remove" : "Add"} ${icebreaker.name} ${isFavorite ? "from" : "to"} favorites`}
            aria-pressed={isFavorite}
            className="relative z-10 min-touch-coarse shrink-0 p-1 -m-1 inline-flex items-center justify-center transition-colors"
          >
            <Heart
              className={`w-4 h-4 transition-all duration-200 ${
                isFavorite
                  ? "fill-accent-magenta text-accent-magenta"
                  : "text-sub hover:text-accent-magenta"
              }`}
            />
          </button>
        </div>
        <CardDescription className="text-xs text-sub line-clamp-2">
          {icebreaker.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={`text-xs ${categoryColors[icebreaker.category]}`}>
            {icebreaker.category}
          </Badge>
          <Badge variant="outline" className="text-xs bg-cardH text-sub border-border">
            <Clock className="w-3 h-3 mr-0.5" />
            {icebreaker.timeMinutes}m
          </Badge>
          <Badge variant="outline" className="text-xs bg-cardH text-sub border-border">
            <Users className="w-3 h-3 mr-0.5" />
            {sizeLabel[icebreaker.teamSize]}
          </Badge>
          <Badge variant="outline" className={`text-xs ${energyColors[icebreaker.energyLevel]}`}>
            <Zap className="w-3 h-3 mr-0.5" />
            {icebreaker.energyLevel}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Featured Card (selected icebreaker) ─────────────────────
function FeaturedCard({
  icebreaker,
  isFavorite,
  onToggleFavorite,
}: {
  icebreaker: IceBreaker;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={icebreaker.id}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Card className="bg-card border-accent-cyan/30 shadow-neon-cyan">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-accent" />
                  <CardTitle className="text-xl font-bold text-text text-glow-cyan">
                    {icebreaker.name}
                  </CardTitle>
                </div>
                <CardDescription className="text-sub text-sm">
                  {icebreaker.description}
                </CardDescription>
              </div>
              <button
                onClick={() => onToggleFavorite(icebreaker.id)}
                aria-label={isFavorite ? "Unfavorite" : "Favorite"}
                className="min-touch-coarse shrink-0 p-2 -m-2 inline-flex items-center justify-center transition-colors"
              >
                <Heart
                  className={`w-5 h-5 transition-all duration-200 ${
                    isFavorite
                      ? "fill-accent-magenta text-accent-magenta"
                      : "text-sub hover:text-accent-magenta"
                  }`}
                />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-accent uppercase tracking-wider">
                Instructions
              </h4>
              <p className="text-sm text-sub leading-relaxed">{icebreaker.instructions}</p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Badge variant="outline" className={`${categoryColors[icebreaker.category]}`}>
                <Tag className="w-3 h-3 mr-1" />
                {icebreaker.category}
              </Badge>
              <Badge variant="outline" className="bg-cardH text-sub border-border">
                <Clock className="w-3 h-3 mr-1" />
                {icebreaker.timeMinutes} minutes
              </Badge>
              <Badge variant="outline" className="bg-cardH text-sub border-border">
                <Users className="w-3 h-3 mr-1" />
                {icebreaker.teamSize} ({sizeLabel[icebreaker.teamSize]} people)
              </Badge>
              <Badge variant="outline" className={`${energyColors[icebreaker.energyLevel]}`}>
                <Zap className="w-3 h-3 mr-1" />
                {icebreaker.energyLevel} energy
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main Client Component ───────────────────────────────────
export function IceBreakerClient() {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");
  const [energyFilter, setEnergyFilter] = useState<EnergyFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selected, setSelected] = useState<IceBreaker | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isSpinning, setIsSpinning] = useState(false);
  const { log } = useHistoryLogger("icebreaker");
  // Track the in-flight shuffle interval so an unmount mid-spin doesn't
  // keep calling setState on a disposed component.
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load favorites from localStorage on mount
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Clear the spin interval on unmount
  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    };
  }, []);

  const toggleFavorite = useCallback(
    (id: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        saveFavorites(next);
        return next;
      });
      log(ICEBREAKER_ACTIONS.PROMPT_FAVORITED, { promptId: id });
    },
    [log]
  );

  const filtered = useMemo(() => {
    return icebreakers.filter((ib) => {
      if (timeFilter !== "all" && ib.timeMinutes !== timeFilter) return false;
      if (sizeFilter !== "all" && ib.teamSize !== sizeFilter) return false;
      if (energyFilter !== "all" && ib.energyLevel !== energyFilter) return false;
      if (categoryFilter !== "all" && ib.category !== categoryFilter) return false;
      return true;
    });
  }, [timeFilter, sizeFilter, energyFilter, categoryFilter]);

  const handleRandomPick = useCallback(() => {
    if (filtered.length === 0) return;
    // Cancel any in-flight spin before starting a new one
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }
    setIsSpinning(true);

    // R5: snapshot the filtered list at spin-start. Previously the
    // interval callback closed over `filtered` from the outer render —
    // if the user toggled a category filter mid-spin, the final pick
    // could be an item NOT in the (new) `filtered` set, confusing the
    // user. Pin the array once.
    const snapshot = filtered;
    // BUG-T4-icebreaker-1: if only one item matches the filter, the
    // spin animation completes and the user sees no movement — looks
    // broken. Short-circuit to the single item without animating.
    if (snapshot.length === 1) {
      const only = snapshot[0];
      setSelected(only);
      setIsSpinning(false);
      log(ICEBREAKER_ACTIONS.PROMPT_DRAWN, {
        promptId: only.id,
        name: only.name,
        category: only.category,
      });
      return;
    }
    // Track the previous selection so the final pick can EXCLUDE it
    // when there's more than one option — a draw that lands on the
    // same item the user just saw is unsatisfying.
    const prevId = selected?.id;
    let count = 0;
    const totalFlashes = 6;
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * snapshot.length);
      setSelected(snapshot[randomIndex]);
      count++;
      if (count >= totalFlashes) {
        clearInterval(interval);
        spinIntervalRef.current = null;
        // Final pick — exclude prevId when length > 1.
        const candidates =
          snapshot.length > 1 && prevId ? snapshot.filter((s) => s.id !== prevId) : snapshot;
        const finalIndex = Math.floor(Math.random() * candidates.length);
        const final = candidates[finalIndex];
        setSelected(final);
        setIsSpinning(false);
        log(ICEBREAKER_ACTIONS.PROMPT_DRAWN, {
          promptId: final.id,
          name: final.name,
          category: final.category,
        });
      }
    }, 80);
    spinIntervalRef.current = interval;
  }, [filtered, log, selected?.id]);

  return (
    <ToolPageWrapper
      toolId="icebreaker"
      title="Ice Breaker Generator"
      description="Find the perfect icebreaker for your next Agile ceremony. Filter by time, team size, energy level, and category, or let the randomizer pick one for you."
      category="Ceremonies"
    >
      <div className="space-y-8">
        {/* ── Filters ────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardContent className="p-5 space-y-4">
            {/* Time */}
            <div className="space-y-2" role="group" aria-labelledby="icebreaker-filter-time">
              <span
                id="icebreaker-filter-time"
                className="text-xs font-semibold text-sub uppercase tracking-wider flex items-center gap-1.5"
              >
                <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Time
              </span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    [2, "2 min"],
                    [5, "5 min"],
                    [10, "10 min"],
                    [15, "15 min"],
                  ] as [TimeFilter, string][]
                ).map(([val, label]) => (
                  <FilterChip
                    key={String(val)}
                    label={label}
                    active={timeFilter === val}
                    onClick={() => setTimeFilter(val)}
                  />
                ))}
              </div>
            </div>

            {/* Team Size */}
            <div className="space-y-2" role="group" aria-labelledby="icebreaker-filter-size">
              <span
                id="icebreaker-filter-size"
                className="text-xs font-semibold text-sub uppercase tracking-wider flex items-center gap-1.5"
              >
                <Users className="w-3.5 h-3.5" aria-hidden="true" /> Team Size
              </span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["small", "Small (2-5)"],
                    ["medium", "Medium (5-10)"],
                    ["large", "Large (10+)"],
                  ] as [SizeFilter, string][]
                ).map(([val, label]) => (
                  <FilterChip
                    key={val}
                    label={label}
                    active={sizeFilter === val}
                    onClick={() => setSizeFilter(val)}
                  />
                ))}
              </div>
            </div>

            {/* Energy Level */}
            <div className="space-y-2" role="group" aria-labelledby="icebreaker-filter-energy">
              <span
                id="icebreaker-filter-energy"
                className="text-xs font-semibold text-sub uppercase tracking-wider flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Energy Level
              </span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["low", "Low"],
                    ["medium", "Medium"],
                    ["high", "High"],
                  ] as [EnergyFilter, string][]
                ).map(([val, label]) => (
                  <FilterChip
                    key={val}
                    label={label}
                    active={energyFilter === val}
                    onClick={() => setEnergyFilter(val)}
                  />
                ))}
              </div>
            </div>

            {/* Category */}
            <div className="space-y-2" role="group" aria-labelledby="icebreaker-filter-category">
              <span
                id="icebreaker-filter-category"
                className="text-xs font-semibold text-sub uppercase tracking-wider flex items-center gap-1.5"
              >
                <Tag className="w-3.5 h-3.5" aria-hidden="true" /> Category
              </span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["question", "Question"],
                    ["activity", "Activity"],
                    ["game", "Game"],
                    ["creative", "Creative"],
                    ["agile", "Agile"],
                  ] as [CategoryFilter, string][]
                ).map(([val, label]) => (
                  <FilterChip
                    key={val}
                    label={label}
                    active={categoryFilter === val}
                    onClick={() => setCategoryFilter(val)}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Random Pick Button ─────────────────────────── */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleRandomPick}
            disabled={filtered.length === 0 || isSpinning}
            className="bg-accent-cyan text-bg font-bold hover:bg-accent-cyan/90 shadow-neon-cyan transition-all duration-200 px-6"
            size="lg"
          >
            <Shuffle className={`w-5 h-5 mr-2 ${isSpinning ? "animate-spin" : ""}`} />
            {isSpinning ? "Picking..." : "Random Pick"}
          </Button>
          <span className="text-sm text-sub">
            {filtered.length} icebreaker{filtered.length !== 1 && "s"} match your filters
          </span>
        </div>

        {/* ── Featured Card ──────────────────────────────── */}
        {selected && (
          <FeaturedCard
            icebreaker={selected}
            isFavorite={favorites.has(selected.id)}
            onToggleFavorite={toggleFavorite}
          />
        )}

        {/* ── Browse All ─────────────────────────────────── */}
        <div className="space-y-4">
          <h2 className="text-lg font-display font-bold text-text">Browse All</h2>
          {filtered.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <p className="text-sub">
                  No icebreakers match your current filters. Try broadening your selection.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((ib) => (
                <IceBreakerCard
                  key={ib.id}
                  icebreaker={ib}
                  isFavorite={favorites.has(ib.id)}
                  onToggleFavorite={toggleFavorite}
                  onSelect={setSelected}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
