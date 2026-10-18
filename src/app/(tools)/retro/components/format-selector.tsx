"use client";

/**
 * Pre-board screen — pick a retro format (card grid) or jump straight in with
 * the Start/Stop/Continue quick-start. Shown when no board exists yet. A
 * first-time visitor (no past retros either) can load an example board.
 */

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import { themed, tint } from "@/lib/utils/theme-color";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import { PastRetros } from "./past-retros";

export function FormatSelector({
  onSelect,
  onLoadExample,
  past = [],
  onDeletePast,
}: {
  onSelect: (format: RetroFormat) => void;
  onLoadExample?: () => void;
  past?: RetroBoard[];
  onDeletePast?: (retro: RetroBoard) => void;
}) {
  return (
    <ToolPageWrapper
      toolId="retro"
      title="Retro Board"
      description="Pick a format and run the retro on a shared screen: write cards, dot-vote, discuss the top items and agree actions."
      category="Ceremonies"
    >
      <div className="space-y-6">
        <h2 className="text-lg font-display font-bold text-text">Choose a Format</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {retroFormats.map((fmt) => (
            // The format name is a real button, stretched over the card, so
            // the picker works from the keyboard and its accessible name is
            // exactly its visible label; the description is read as its
            // description.
            <div key={fmt.id} className="group relative h-full">
              <Card className="h-full bg-card border-border group-hover:border-accent-cyan/40 transition-all duration-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-text group-hover:text-accent transition-colors">
                    <button
                      type="button"
                      onClick={() => onSelect(fmt)}
                      aria-describedby={`retro-format-${fmt.id}-desc`}
                      className="text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-bg"
                    >
                      {fmt.name}
                    </button>
                  </CardTitle>
                  <CardDescription
                    id={`retro-format-${fmt.id}-desc`}
                    className="text-xs text-sub line-clamp-2"
                  >
                    {fmt.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {fmt.columns.map((col) => (
                      <span
                        key={col.key}
                        className="text-xs px-2 py-0.5 rounded-full border font-medium"
                        style={{
                          color: themed(col.color),
                          borderColor: tint(col.color, 33),
                          backgroundColor: tint(col.color, 8),
                        }}
                      >
                        {col.icon} {col.label}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => onSelect(retroFormats[0])}
            className="bg-accent-cyan text-bg font-bold hover:bg-accent-cyan/90 shadow-neon-cyan"
          >
            Quick Start: Start / Stop / Continue
          </Button>
          {onLoadExample && past.length === 0 && <LoadExampleButton onLoad={onLoadExample} />}
        </div>

        {onDeletePast && <PastRetros retros={past} onDelete={onDeletePast} />}
      </div>
    </ToolPageWrapper>
  );
}
