"use client";

import { useMemo, useState } from "react";
import { categories, getToolsByCategory, tools as allTools } from "@/lib/constants/tools";
import { PageHeader } from "@/components/shared/page-header";
import { ToolCard } from "@/components/shared/tool-card";
import { InsightsEngine } from "@/components/shared/insights-engine";
import { MoodReveal } from "@/components/shared/mood-reveal";
import { ArrowRight, Zap, TrendingUp, Radio, Sparkles, Filter } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type FilterId = "all" | "smart" | "live" | "new";

export default function Home() {
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");

  const filteredByCategory = useMemo(() => {
    return categories
      .map((category) => {
        let list = getToolsByCategory(category);
        if (activeFilter === "smart") list = list.filter((t) => (t.analyticsFeatures?.length ?? 0) > 0);
        if (activeFilter === "live") list = list.filter((t) => t.isRealtime);
        if (activeFilter === "new") list = list.filter((t) => t.badge === "new");
        return { category, tools: list };
      })
      .filter((c) => c.tools.length > 0);
  }, [activeFilter]);

  const totalCount = allTools.length;
  const smartCount = allTools.filter((t) => (t.analyticsFeatures?.length ?? 0) > 0).length;
  const liveCount = allTools.filter((t) => t.isRealtime).length;
  const newCount = allTools.filter((t) => t.badge === "new").length;

  const filters: { id: FilterId; label: string; icon: typeof Zap; count: number }[] = [
    { id: "all", label: "All", icon: Filter, count: totalCount },
    { id: "smart", label: "Smart", icon: TrendingUp, count: smartCount },
    { id: "live", label: "Live", icon: Radio, count: liveCount },
    { id: "new", label: "New", icon: Sparkles, count: newCount },
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

      {/* Insights Banner */}
      <div
        className="mb-6 sm:mb-10 animate-slide-up delay-1"
        style={{ animationFillMode: "forwards", opacity: 0 }}
      >
        <InsightsEngine limit={3} />
      </div>

      {/* Impact Metrics — responsive grid, no overflow on mobile */}
      <div
        className="grid grid-cols-4 gap-2 sm:gap-6 md:gap-8 mb-6 sm:mb-8 animate-slide-up delay-1 stagger-item"
        style={{ animationFillMode: "forwards" }}
      >
        {[
          { value: `${totalCount}`, label: "Tools" },
          { value: `${categories.length}`, label: "Categories" },
          { value: `${smartCount}`, label: "Smart" },
          { value: `${liveCount}`, label: "Live" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={`text-center animate-fade-in delay-${i + 1}`}
            style={{ animationFillMode: "forwards", opacity: 0 }}
          >
            <div className="font-mono text-2xl sm:text-3xl md:text-h5 font-bold text-accent text-glow leading-none">
              {stat.value}
            </div>
            <div className="font-mono text-[9px] sm:text-nano text-sub tracking-wider uppercase mt-1 truncate">
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

      {/* Tool Grid by Category — each grid reveals on scroll with the active
          mood profile's easing.  Playful → bouncy cards, Focused → sharp
          snap, Melancholy → slow fade.  Keyed by filter so switching tabs
          remounts the reveal and re-animates the new tool set. */}
      {filteredByCategory.map(({ category, tools }) => (
        <section key={category} className="mb-8 sm:mb-12">
          <PageHeader label={category} title={category} />
          <MoodReveal
            key={`${category}-${activeFilter}`}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
            duration={0.55}
            stagger={0.07}
            from={{ opacity: 0, y: 24, scale: 0.98 }}
            to={{ opacity: 1, y: 0, scale: 1, clearProps: "transform" }}
          >
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <ToolCard
                  key={tool.id}
                  href={tool.path}
                  icon={<Icon className="w-5 h-5" aria-hidden="true" />}
                  title={tool.name}
                  description={tool.description}
                  tags={tool.badge ? [tool.badge] : undefined}
                />
              );
            })}
          </MoodReveal>
        </section>
      ))}

      {filteredByCategory.length === 0 && (
        <div className="text-center py-12 sm:py-16 text-sub text-sm">
          No tools match the current filter.
        </div>
      )}
    </div>
  );
}
