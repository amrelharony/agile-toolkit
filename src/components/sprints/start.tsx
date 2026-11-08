"use client";

import { useId } from "react";
import { CalendarRange, Eye, FlaskConical, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";

/** No sprints yet: create one, or look around an example first. */
export function SprintsEmptyState({
  onCreate,
  onExample,
}: {
  onCreate: () => void;
  onExample: () => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center"
    >
      <CalendarRange className="h-8 w-8 text-accent" aria-hidden="true" />
      <h2 id={headingId} className="font-display text-lg font-semibold text-text">
        No sprints yet
      </h2>
      <p className="max-w-prose text-sm text-sub">
        Create a sprint once, and Burndown, Burnup, Velocity and Sprint Comparison all track it.
        This page then shows where it stands.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Create your first sprint
        </Button>
        <Button type="button" variant="outline" onClick={onExample}>
          <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
          See an example
        </Button>
      </div>
    </section>
  );
}

/** Shown over the example preview: nothing in it is saved. */
export function ExampleBanner({ onStart, onExit }: { onStart: () => void; onExit: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
    >
      <FlaskConical className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Example sprints.</span> Look around: nothing here is saved.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onStart}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Start your own
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onExit}>
          <X className="mr-1 h-4 w-4" aria-hidden="true" />
          Close example
        </Button>
      </div>
    </div>
  );
}

/**
 * While the workspace loads, or old sprint data is being moved in. On phones
 * and tablets it holds the room the sprint tool will take, so the cockpit or
 * start flow that replaces it doesn't push the page down (home, Sprint
 * Cockpit, Sprint Planning, Burndown and the other sprint tools).
 */
export function LoadingSprints() {
  return <WorkspaceLoading>Loading sprints…</WorkspaceLoading>;
}
