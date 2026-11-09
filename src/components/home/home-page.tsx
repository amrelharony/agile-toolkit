"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Compass, ShieldCheck, TrendingUp } from "lucide-react";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";
import { PageHeader } from "@/components/shared/page-header";
import { InsightsEngine } from "@/components/shared/insights-engine";
import { HomeSearch } from "@/components/home/home-search";
import { JobLauncher } from "@/components/home/job-launcher";
import { ContinueSection } from "@/components/home/continue-section";
import { ToolSections } from "@/components/home/tool-sections";
import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";

/**
 * Home: say what this is, then the team's sprint — the cockpit once a sprint
 * exists, the three-step start before that — then the common jobs, what they
 * used last, the comic, and the full index. The sprint block needs this
 * browser's data, so the server renders it as a placeholder of about its size
 * and the cockpit fills it once the workspace has loaded. The comic's card
 * comes from the server page (app/page), since only the server can read the
 * stories.
 */
export function HomePage({ comicBanner }: { comicBanner?: ReactNode }) {
  const { tools: visibleTools, shelfCount, showAll } = useToolVisibility();
  const hydrated = useWorkspaceHydrated();
  const hasSprints = useWorkspaceStore((s) => (s.sprints?.length ?? 0) > 0);
  // Reading material (the comic) lives in the grid but isn't an interactive
  // tool, so it stays out of the "N tools" number.
  const toolCount = visibleTools.filter((t) => t.kind !== "reading").length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-10 px-4 py-6 sm:space-y-12 sm:px-6 sm:py-8 md:p-8">
      {/* Hero */}
      <div className="animate-slide-up pt-6 sm:pt-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 sm:mb-6 sm:px-4 sm:py-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span className="text-xs font-medium text-accent">
            Free · No sign-up · Your data stays in your browser
          </span>
        </div>
        <PageHeader
          title="Agile Toolkit"
          subtitle={`${toolCount} interactive tools for Scrum masters and agile teams. Plan the sprint, run the daily and the retro, estimate together, track delivery and keep the team healthy.`}
        />
        <div className="mt-4 flex flex-col gap-3 sm:mt-2 sm:flex-row sm:items-start">
          <HomeSearch />
          {hydrated && hasSprints ? (
            <Link
              href="/sprint"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:border-accent/40 hover:text-accent sm:h-10 sm:min-h-0"
            >
              <Compass className="h-4 w-4" aria-hidden="true" />
              Sprint Cockpit
            </Link>
          ) : (
            <Link
              href="/health-dashboard"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:border-accent/40 hover:text-accent sm:h-10 sm:min-h-0"
            >
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
              Team dashboard
            </Link>
          )}
        </div>
      </div>

      {/* Rendered on the server too: until the workspace loads, the cockpit is
          its "Loading sprints…" placeholder, which holds the block's room on
          phones. Inserting the whole block after hydration pushed the job
          cards down under the reader's thumb. Until then nobody knows whether
          the reader has a sprint, so the heading keeps its line but stays
          hidden, with a neutral name for the region: "Start your sprint"
          used to flash above a returning team's sprint on every load. */}
      <section aria-labelledby="your-sprint-heading" className="space-y-4">
        <h2
          id="your-sprint-heading"
          className={cn("font-display text-lg font-semibold text-text", !hydrated && "invisible")}
        >
          {!hydrated ? "Sprint" : hasSprints ? "Your sprint" : "Start your sprint"}
        </h2>
        <SprintCockpit compact />
      </section>

      <JobLauncher />

      <ContinueSection />

      <InsightsEngine limit={3} />

      {comicBanner}

      <section
        id="all-tools"
        aria-labelledby="all-tools-heading"
        className="scroll-mt-20 space-y-4"
      >
        <h2 id="all-tools-heading" className="font-display text-lg font-semibold text-text">
          All {toolCount} tools, by job
        </h2>
        <ToolSections />
        {!showAll && shelfCount > 0 && (
          <p className="text-sm text-sub">
            <Link href="/more-tools" className="font-medium text-text hover:text-accent">
              {shelfCount} more tools
            </Link>{" "}
            for AI product work, security, reliability and strategy are on the shelf.
          </p>
        )}
      </section>
    </div>
  );
}
