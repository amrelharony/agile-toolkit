"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolCard } from "@/components/shared/tool-card";
import { getShelfToolsByCategory } from "@/lib/tools/catalog";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";

/**
 * The "More tools" shelf: everything built for a neighbouring audience, by
 * registry category, with the switch that lists them in navigation and
 * search again. The list itself is static (lib/tools/catalog); only the
 * switch follows the visitor's preference.
 */
export function MoreToolsClient() {
  const { showAll, setShowAll, shelfCount } = useToolVisibility();
  const switchId = useId();
  const groups = getShelfToolsByCategory();

  return (
    <div className="container-tool space-y-8 py-8">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-fluid-h2 font-semibold text-text">More tools</h1>
          <p className="max-w-2xl text-sub">
            The toolkit is built for Scrum masters and agile teams, so these {shelfCount} tools for
            neighbouring work — AI product management, security, reliability and incident response,
            developer-experience surveys and strategy frameworks — stay off the home page, the
            sidebar and search results. Every one still works and keeps its guide; open it from
            here, or show them all.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <Switch id={switchId} checked={showAll} onCheckedChange={setShowAll} />
          <Label htmlFor={switchId} className="cursor-pointer text-sm text-text">
            Show these tools in navigation and search
          </Label>
        </div>
      </header>

      {groups.map((group) => {
        const headingId = `shelf-${group.category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
        return (
          <section key={group.category} aria-labelledby={headingId} className="space-y-3">
            <h2 id={headingId} className="font-display text-lg font-semibold text-text">
              {group.category}
              <span className="ml-2 font-mono text-xs font-normal text-sub">
                {group.tools.length} {group.tools.length === 1 ? "tool" : "tools"}
              </span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {group.tools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <ToolCard
                    key={tool.id}
                    toolId={tool.id}
                    href={tool.path}
                    icon={<Icon className="h-5 w-5" aria-hidden="true" />}
                    title={tool.name}
                    description={tool.description}
                    tags={tool.badge ? [tool.badge] : undefined}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
