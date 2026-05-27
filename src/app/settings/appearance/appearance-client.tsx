"use client";

import { useEffect, useState } from "react";
import { Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useHolidayStore } from "@/lib/stores/holiday-store";

export function AppearanceClient() {
  const enabled = useHolidayStore((s) => s.enabled);
  const dismissedWindows = useHolidayStore((s) => s.dismissedWindows);
  const setEnabled = useHolidayStore((s) => s.setEnabled);
  const clearDismissed = useHolidayStore((s) => s.clearDismissed);

  // The store uses skipHydration; the engine triggers rehydrate elsewhere, but
  // this page may render before that runs. Wait for client mount before
  // showing state to avoid a brief flash of defaults.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void Promise.resolve(useHolidayStore.persist.rehydrate())
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const dismissedCount = Object.keys(dismissedWindows).length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <label
              htmlFor="holiday-enabled"
              className="flex items-center gap-2 text-text font-medium"
            >
              <Sparkles className="w-4 h-4 holiday-accent-text" aria-hidden="true" />
              Holiday themes
            </label>
            <p className="text-sub text-sm max-w-xl">
              When on, the app detects the current date in Africa/Cairo and applies the matching
              holiday accent + a subtle particle layer. Reduced-motion and data-saver preferences
              are respected automatically.
            </p>
          </div>
          <Switch
            id="holiday-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!hydrated}
            aria-label="Toggle holiday themes"
            className="min-touch-coarse shrink-0"
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <h2 className="text-text font-medium">Dismissed themes</h2>
            <p className="text-sub text-sm max-w-xl">
              {dismissedCount === 0
                ? "No themes have been dismissed in the past 18 months."
                : `${dismissedCount} dismissed theme window${dismissedCount === 1 ? "" : "s"} on file. Clearing brings them back if their date window is still active.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={clearDismissed}
            disabled={!hydrated || dismissedCount === 0}
            className="shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            Clear dismissals
          </Button>
        </div>
      </section>
    </div>
  );
}
