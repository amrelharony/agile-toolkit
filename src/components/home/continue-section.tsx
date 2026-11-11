"use client";

import Link from "@/components/motion/transition-link";
import { Clock, Star } from "lucide-react";
import { isVipHidden } from "@/lib/tools/catalog";
import { useToolPrefs } from "@/lib/tools/tool-prefs";
import { useVipHint } from "@/lib/vip/use-vip-hint";
import { getToolById, type ToolDefinition } from "@/lib/constants/tools";

function timeAgo(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function ToolLink({ tool, meta }: { tool: ToolDefinition; meta?: string }) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.path}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{tool.name}</span>
      {meta && <span className="shrink-0 text-xs text-sub">{meta}</span>}
    </Link>
  );
}

/**
 * "Continue where you left off": recent tools and favorites, for returning
 * visitors. Renders nothing on a first visit.
 */
export function ContinueSection() {
  const { favorites, recent } = useToolPrefs();
  const vip = useVipHint();
  const recentTools = recent.flatMap((r) => {
    const tool = getToolById(r.id);
    return tool && !isVipHidden(tool, vip) ? [{ tool, usedAt: r.usedAt }] : [];
  });
  const favoriteTools = favorites.flatMap((id) => {
    const tool = getToolById(id);
    return tool && !isVipHidden(tool, vip) ? [tool] : [];
  });
  if (recentTools.length === 0 && favoriteTools.length === 0) return null;

  return (
    <section aria-labelledby="continue-heading" className="space-y-4">
      <h2 id="continue-heading" className="font-display text-lg font-semibold text-text">
        Continue where you left off
      </h2>
      <div className="grid gap-6 md:grid-cols-2">
        {recentTools.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Recent
            </h3>
            <ul className="grid gap-2">
              {recentTools.map(({ tool, usedAt }) => (
                <li key={tool.id}>
                  <ToolLink tool={tool} meta={timeAgo(usedAt)} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {favoriteTools.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
              <Star className="h-3.5 w-3.5" aria-hidden="true" />
              Favorites
            </h3>
            <ul className="grid gap-2">
              {favoriteTools.map((tool) => (
                <li key={tool.id}>
                  <ToolLink tool={tool} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
