"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolCard } from "@/components/shared/tool-card";
import { getShelfToolsByCategory } from "@/lib/tools/catalog";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";

/** The id of a category's heading: the anchor the jump chips link to. */
function shelfHeadingId(category: string): string {
  return `shelf-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

const toolsWord = (n: number) => (n === 1 ? "tool" : "tools");

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
        {/* Below lg the shelf is one long column (over 6,000px on a phone):
            a row of chips, scrolling sideways, jumps to each category. */}
        <nav aria-label="Jump to a category" className="lg:hidden">
          {/* relative: the chips' sr-only counts are absolutely positioned, and
              without a containing block they escape this scroller and widen
              the page (the .scroll-x-snap lesson). */}
          <ul className="relative -mx-1 flex gap-2 overflow-x-auto overscroll-x-contain px-1 py-1">
            {groups.map((group) => (
              <li key={group.category} className="shrink-0">
                <a
                  href={`#${shelfHeadingId(group.category)}`}
                  className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3 text-sm text-text transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:min-h-11"
                >
                  {group.category}{" "}
                  <span className="font-mono text-xs text-sub">
                    {group.tools.length}{" "}
                    <span className="sr-only">{toolsWord(group.tools.length)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {groups.map((group) => {
        const headingId = shelfHeadingId(group.category);
        return (
          <section key={group.category} aria-labelledby={headingId} className="space-y-3">
            {/* scroll-mt keeps a jumped-to heading clear of the sticky header. */}
            <h2
              id={headingId}
              className="scroll-mt-20 font-display text-lg font-semibold text-text"
            >
              {group.category}
              {/* One unit, so a long name never leaves "tools" alone on a line. */}
              <span className="ml-2 inline-block whitespace-nowrap font-mono text-xs font-normal text-sub">
                {group.tools.length} {toolsWord(group.tools.length)}
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
