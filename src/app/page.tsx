"use client";

import { useMemo, useState } from "react";
import {
  categories,
  getToolsByCategory,
  tools as allTools,
  type ToolDefinition,
} from "@/lib/constants/tools";
import { PageHeader } from "@/components/shared/page-header";
import { ToolCard } from "@/components/shared/tool-card";
import { InsightsEngine } from "@/components/shared/insights-engine";
import { MoodReveal } from "@/components/shared/mood-reveal";
import { FeaturedComicBanner } from "@/components/comic/featured-comic-banner";
import { comicAsset } from "@/lib/comic/agile-at-work";
import { ArrowRight, Zap, TrendingUp, Radio, Filter, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type FilterId = "all" | "smart" | "live";

// Reading material (the comic) lives in the grid but isn't an interactive
// tool, so it stays out of every "N tools" number.
const interactiveTools = allTools.filter((t) => t.kind !== "reading");
// Empty categories are hidden in the grid and sidebar, so don't count them.
const categoryCount = categories.filter((c) => getToolsByCategory(c).length > 0).length;

/** "3 tools", or "1 title" for a row that only holds reading material. */
function countLabel(list: ToolDefinition[]): string {
  const noun = list.every((t) => t.kind === "reading") ? "title" : "tool";
  return `${list.length} ${list.length === 1 ? noun : `${noun}s`}`;
}

export default function Home() {
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");

  const filteredByCategory = useMemo(() => {
    return categories
      .map((category) => {
        let list = getToolsByCategory(category);
        if (activeFilter === "smart")
          list = list.filter((t) => (t.analyticsFeatures?.length ?? 0) > 0);
        if (activeFilter === "live") list = list.filter((t) => t.isRealtime);
        return { category, tools: list };
      })
      .filter((c) => c.tools.length > 0);
  }, [activeFilter]);

  const totalCount = interactiveTools.length;
  const smartCount = interactiveTools.filter((t) => (t.analyticsFeatures?.length ?? 0) > 0).length;
  const liveCount = interactiveTools.filter((t) => t.isRealtime).length;
  // Build-time flag (scripts/comic-asset.mjs): no banner until the PDF is committed.
  const showComic = comicAsset().available;

  const filters: { id: FilterId; label: string; icon: typeof Zap; count: number }[] = [
    { id: "all", label: "All", icon: Filter, count: totalCount },
    { id: "smart", label: "Smart", icon: TrendingUp, count: smartCount },
    { id: "live", label: "Live", icon: Radio, count: liveCount },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 md:p-8 max-w-[1200px] mx-auto">
      {/* Hero */}
      <div className="py-6 sm:py-10 md:py-12 animate-slide-up">
        <div className="inline-flex items-center gap-2 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full border border-border bg-[rgba(0,225,255,0.05)] mb-4 sm:mb-6">
          <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-accent" aria-hidden="true" />
          <span className="font-mono text-[10px] sm:text-micro text-accent tracking-wider uppercase">
            Free &amp; Open Source
          </span>
        </div>
        <PageHeader
          title="Agile Toolkit"
          subtitle={`${totalCount} interactive tools with cross-tool intelligence, predictive forecasting, and real-time multiplayer. Plan sprints, track metrics, run ceremonies, and build better teams.`}
          gradient
        />
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-4 sm:mt-2">
          <Link
            href="/capacity-planner"
            className="
              inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl
              bg-accent text-bg font-mono text-xs sm:text-sm font-semibold uppercase tracking-wider
              hover:shadow-glow-strong active-press
              transition-all duration-default ease-spring
              min-h-[44px]
            "
          >
            Get Started
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link
            href="/health-dashboard"
            className="
              inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl
              border border-border bg-surface text-text font-mono text-xs sm:text-sm font-semibold uppercase tracking-wider
              hover:border-accent/40 hover:text-accent
              transition-all duration-default ease-spring
              min-h-[44px]
            "
          >
            Insights Hub
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {showComic && (
        <div
          className="mb-6 sm:mb-10 animate-slide-up delay-1"
          style={{ animationFillMode: "forwards", opacity: 0 }}
        >
          <FeaturedComicBanner />
        </div>
      )}

      {/* Insights Banner */}
      <div
        className="mb-6 sm:mb-10 animate-slide-up delay-1"
        style={{ animationFillMode: "forwards", opacity: 0 }}
      >
        <InsightsEngine limit={3} />
      </div>

      {/* Impact Metrics — 2 × 2 on phones (the prior grid-cols-4 squashed
          the "Categories" tile down to ~83 px which couldn't seat the
          mono-display digits comfortably), 4-up from sm+ where the
          viewport has room. Gap also scales from 12 → 24 → 32 px. */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 md:gap-8 mb-6 sm:mb-8 animate-slide-up delay-1 stagger-item"
        style={{ animationFillMode: "forwards" }}
      >
        {[
          { value: `${totalCount}`, label: "Tools" },
          { value: `${categoryCount}`, label: "Categories" },
          { value: `${smartCount}`, label: "Smart" },
          { value: `${liveCount}`, label: "Live" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={`text-center animate-fade-in delay-${i + 1}`}
            style={{ animationFillMode: "forwards", opacity: 0 }}
          >
            <div className="font-mono text-3xl sm:text-3xl md:text-h5 font-bold text-accent text-glow leading-none">
              {stat.value}
            </div>
            <div className="font-mono text-[10px] sm:text-nano text-sub tracking-wider uppercase mt-1 truncate">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter Chips — scrollable row on mobile */}
      <div
        className="flex flex-wrap gap-2 mb-8 sm:mb-10 animate-slide-up overflow-x-auto -mx-1 px-1 pb-1"
        style={{ animationFillMode: "forwards" }}
        role="tablist"
        aria-label="Tool filters"
      >
        {filters.map((f) => {
          const Icon = f.icon;
          const active = activeFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveFilter(f.id)}
              role="tab"
              aria-selected={active}
              className={cn(
                "inline-flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-lg border text-xs font-mono uppercase tracking-wider transition-all whitespace-nowrap min-h-[36px]",
                active
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border bg-surface text-sub hover:text-text hover:border-accent/30"
              )}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {f.label}
              <span className="text-text/60 font-data">{f.count}</span>
            </button>
          );
        })}
      </div>

      {/* Tool Grid by Category — categories are collapsed by default so the
          home page reads as an index, not a wall of cards. Click the summary
          row to expand. Native <details>/<summary> keeps it accessible and
          remembers no state across renders (always closed on navigation),
          which matches the "index first" intent. */}
      {filteredByCategory.map(({ category, tools }) => (
        <details
          key={`${category}-${activeFilter}`}
          className="mb-3 sm:mb-4 group rounded-lg border border-border bg-surface/40 overflow-hidden"
        >
          <summary
            className={cn(
              "list-none cursor-pointer select-none flex items-center justify-between gap-3",
              "px-4 py-3 sm:px-5 sm:py-4 hover:bg-surface transition-colors",
              "[&::-webkit-details-marker]:hidden"
            )}
          >
            <span className="flex items-center gap-3 min-w-0">
              <ChevronDown
                className="w-4 h-4 shrink-0 text-sub transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              />
              <span className="font-display text-sm sm:text-base text-text truncate">
                {category}
              </span>
            </span>
            <span className="font-mono text-[10px] sm:text-xs text-sub shrink-0">
              {countLabel(tools)}
            </span>
          </summary>
          <MoodReveal
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 p-4 sm:p-5 pt-2 sm:pt-2"
            duration={0.4}
            stagger={0.05}
            from={{ opacity: 0, y: 12, scale: 0.99 }}
            to={{ opacity: 1, y: 0, scale: 1, clearProps: "transform" }}
          >
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <ToolCard
                  key={tool.id}
                  toolId={tool.id}
                  href={tool.path}
                  icon={<Icon className="w-5 h-5" aria-hidden="true" />}
                  title={tool.name}
                  description={tool.description}
                  tags={tool.badge ? [tool.badge] : undefined}
                />
              );
            })}
          </MoodReveal>
        </details>
      ))}

      {filteredByCategory.length === 0 && (
        <div className="text-center py-12 sm:py-16 text-sub text-sm">
          No tools match the current filter.
        </div>
      )}
    </div>
  );
}
