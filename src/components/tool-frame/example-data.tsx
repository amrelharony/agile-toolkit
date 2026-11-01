"use client";

import { FlaskConical, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Example data for empty tools.
 *
 * A first-time visitor used to land on an empty form with no idea what a
 * filled-in RICE table or retro looks like. Tools offer "Load an example"
 * in their empty state; the example rows carry ids starting with
 * `example-`, so the tool can show a notice while any are present and
 * remove exactly those rows (never the user's own) on "Clear example".
 */

// The id helpers live in a plain module so server code (agent actions) can call them.
export { EXAMPLE_ID_PREFIX, exampleId, hasExampleItems, isExampleId } from "@/lib/utils/example-id";

/** "Load an example" for a tool's empty state. */
export function LoadExampleButton({
  onLoad,
  label = "Load an example",
  className,
}: {
  onLoad: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onLoad} className={className}>
      <Sparkles aria-hidden="true" />
      {label}
    </Button>
  );
}

/** Shown while example rows are on screen; "Clear example" removes only them. */
export function ExampleNotice({ onClear }: { onClear: () => void }) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
    >
      <FlaskConical className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Example data.</span> Explore it, edit it, or clear it and
        start with your own.
      </p>
      <Button type="button" size="sm" variant="ghost" onClick={onClear}>
        <X aria-hidden="true" />
        Clear example
      </Button>
    </div>
  );
}
