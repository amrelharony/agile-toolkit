"use client";

import { useId } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart2,
  BarChart3,
  Clock,
  GitCompare,
  Layers,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import type { SprintToolId } from "@/lib/sprints/hub-view";

interface ToolLink {
  path: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
}

export const SPRINT_TOOLS: Record<SprintToolId, ToolLink> = {
  burndown: {
    path: "/burndown",
    name: "Burndown",
    blurb: "Points left each day against the ideal line",
    icon: BarChart3,
  },
  burnup: {
    path: "/burnup",
    name: "Burnup",
    blurb: "Work done against total scope, so added work shows",
    icon: BarChart2,
  },
  velocity: {
    path: "/velocity",
    name: "Velocity",
    blurb: "Committed and done, sprint by sprint",
    icon: Activity,
  },
  "sprint-compare": {
    path: "/sprint-compare",
    name: "Sprint Comparison",
    blurb: "Rate sprints and compare them side by side",
    icon: GitCompare,
  },
  "release-planner": {
    path: "/release-planner",
    name: "Release Planner",
    blurb: "Forecast a release date from your velocity",
    icon: TrendingUp,
  },
};

const ORDER: SprintToolId[] = [
  "burndown",
  "burnup",
  "velocity",
  "sprint-compare",
  "release-planner",
];

const BOARD_TOOLS: ToolLink[] = [
  {
    path: "/cumulative-flow",
    name: "Cumulative Flow",
    blurb: "Items in each stage over time, to spot bottlenecks",
    icon: Layers,
  },
  {
    path: "/cycle-time",
    name: "Cycle Time",
    blurb: "How long items take from start to finish",
    icon: Clock,
  },
];

const CARD =
  "group flex h-full min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/50 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ToolCard({ tool, href, status }: { tool: ToolLink; href: string; status?: string }) {
  const Icon = tool.icon;
  return (
    <Link href={href} className={CARD}>
      <span className="flex items-center gap-2 font-medium text-text group-hover:text-accent">
        <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        {tool.name}
      </span>
      <span className="text-xs text-sub">{tool.blurb}</span>
      {status && <span className="mt-1 text-sm text-text">{status}</span>}
    </Link>
  );
}

/**
 * The sprint tools, each opening on this sprint, with one line of status.
 * `sprintId` is left off for an example preview, so the tools open on the
 * user's own sprints.
 */
export function SprintToolCards({
  sprintId,
  status,
}: {
  sprintId: string | undefined;
  status: Record<SprintToolId, string>;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-sm font-semibold text-text">
        Sprint tools
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {ORDER.map((id) => (
          <li key={id} className="min-w-0">
            <ToolCard
              tool={SPRINT_TOOLS[id]}
              href={sprintHref(SPRINT_TOOLS[id].path, sprintId)}
              status={status[id]}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cumulative Flow and Cycle Time track the board, not a sprint: plain links. */
export function BoardLevelTools() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h2 id={headingId} className="text-sm font-semibold text-text">
          Flow, board-level
        </h2>
        <p className="text-xs text-sub">Tracks your board, not a sprint.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {BOARD_TOOLS.map((tool) => (
          <li key={tool.path} className="min-w-0">
            <ToolCard tool={tool} href={tool.path} />
          </li>
        ))}
      </ul>
    </section>
  );
}
