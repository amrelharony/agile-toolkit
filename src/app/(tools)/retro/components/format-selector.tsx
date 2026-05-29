"use client";

/**
 * Pre-board screen — pick a retro format (card grid) or jump straight in with
 * the Start/Stop/Continue quick-start. Shown when no board exists yet.
 */

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";

export function FormatSelector({ onSelect }: { onSelect: (format: RetroFormat) => void }) {
  return (
    <ToolPageWrapper
      toolId="retro"
      title="Retro Board"
      description="Run collaborative retrospectives with your team. Choose a format to get started — multiplayer sync coming soon."
      category="Ceremonies"
    >
      <div className="space-y-6">
        <h2 className="text-lg font-display font-bold text-text">Choose a Format</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {retroFormats.map((fmt) => (
            <Card
              key={fmt.id}
              className="bg-card border-border hover:border-accent-cyan/40 transition-all duration-200 cursor-pointer group"
              onClick={() => onSelect(fmt)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-text group-hover:text-accent transition-colors">
                  {fmt.name}
                </CardTitle>
                <CardDescription className="text-xs text-sub line-clamp-2">
                  {fmt.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {fmt.columns.map((col) => (
                    <span
                      key={col.key}
                      className="text-[10px] px-2 py-0.5 rounded-full border font-medium"
                      style={{
                        color: col.color,
                        borderColor: `${col.color}55`,
                        backgroundColor: `${col.color}15`,
                      }}
                    >
                      {col.icon} {col.label}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button
          size="lg"
          onClick={() => onSelect(retroFormats[0])}
          className="bg-accent-cyan text-bg font-bold hover:bg-accent-cyan/90 shadow-neon-cyan"
        >
          Quick Start: Start / Stop / Continue
        </Button>
      </div>
    </ToolPageWrapper>
  );
}
