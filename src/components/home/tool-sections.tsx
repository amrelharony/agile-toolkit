"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SECTIONS } from "@/lib/constants/sections";
import { getVisibleTools } from "@/lib/tools/catalog";
import type { ToolDefinition } from "@/lib/constants/tools";
import { ToolCard } from "@/components/shared/tool-card";
import { MoodReveal } from "@/components/shared/mood-reveal";
import { cn } from "@/lib/utils";

/**
 * Every tool, grouped by the job it serves (lib/constants/sections) rather
 * than the 18 build-time categories. Sections start collapsed so the page
 * reads as an index, and a section's cards are only rendered once it has
 * been opened — 110 animated cards on first paint cost more than the whole
 * rest of the page.
 */
export function ToolSections() {
  const visible = new Map(getVisibleTools().map((t) => [t.id, t]));
  const sections = SECTIONS.map((s) => ({
    ...s,
    tools: s.toolIds.flatMap((id) => visible.get(id) ?? []),
  })).filter((s) => s.tools.length > 0);

  return (
    <div className="space-y-3 sm:space-y-4">
      {sections.map((section) => (
        <SectionGroup key={section.id} section={section} />
      ))}
    </div>
  );
}

function SectionGroup({
  section,
}: {
  section: {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tools: ToolDefinition[];
  };
}) {
  const [opened, setOpened] = useState(false);
  const Icon = section.icon;
  return (
    <details
      className="group overflow-hidden rounded-lg border border-border bg-surface/40"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary
        className={cn(
          "flex cursor-pointer select-none list-none items-center justify-between gap-3",
          "px-4 py-3 transition-colors hover:bg-surface sm:px-5 sm:py-4",
          "[&::-webkit-details-marker]:hidden"
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <ChevronDown
            className="h-4 w-4 shrink-0 text-sub transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
          <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate font-display text-sm text-text sm:text-base">
            {section.label}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-sub">
          {section.tools.length} {section.tools.length === 1 ? "tool" : "tools"}
        </span>
      </summary>
      {opened && (
        <MoodReveal
          className="grid grid-cols-1 gap-3 p-4 pt-2 sm:grid-cols-2 sm:gap-4 sm:p-5 sm:pt-2 lg:grid-cols-3"
          duration={0.4}
          stagger={0.05}
          from={{ opacity: 0, y: 12, scale: 0.99 }}
          to={{ opacity: 1, y: 0, scale: 1, clearProps: "transform" }}
        >
          {section.tools.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <ToolCard
                key={tool.id}
                toolId={tool.id}
                href={tool.path}
                icon={<ToolIcon className="h-5 w-5" aria-hidden="true" />}
                title={tool.name}
                description={tool.description}
                tags={tool.badge ? [tool.badge] : undefined}
              />
            );
          })}
        </MoodReveal>
      )}
    </details>
  );
}
