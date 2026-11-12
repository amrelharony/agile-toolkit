"use client";

/**
 * Pick a format: one tap sets up a round of it (the built-in formats, then
 * the host's own). Each is a toggle button (aria-pressed), so a screen
 * reader hears which one is set up; a saved format can be deleted with Undo.
 */

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QUICK_VOTE_PRESETS, type QuickVotePreset } from "@/lib/quick-vote/presets";
import type { CustomPreset } from "@/lib/quick-vote/state";

const KIND_WORD: Record<QuickVotePreset["kind"], string> = {
  scale: "Scale",
  choice: "Choice",
  rank: "Ranking",
  number: "Number",
};

export function PresetPicker({
  presetId,
  customId,
  customPresets,
  onPick,
  onPickCustom,
  onDeleteCustom,
  readOnly = false,
}: {
  presetId: string | null;
  customId: string | null;
  customPresets: readonly CustomPreset[];
  onPick: (preset: QuickVotePreset) => void;
  onPickCustom: (preset: CustomPreset) => void;
  onDeleteCustom: (preset: CustomPreset) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Formats"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
      >
        {QUICK_VOTE_PRESETS.map((p) => {
          const on = customId === null && presetId === p.id;
          return (
            <Button
              key={p.id}
              type="button"
              variant={on ? "toolkit" : "outline"}
              aria-pressed={on}
              onClick={() => onPick(p)}
              className={cn(
                "h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal py-2 text-left",
                on && "ring-1 ring-accent"
              )}
            >
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="text-xs font-normal text-sub">{p.blurb}</span>
            </Button>
          );
        })}
      </div>
      {customPresets.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Your formats</h3>
          <ul className="space-y-2">
            {customPresets.map((p) => {
              const on = customId === p.id;
              const base = QUICK_VOTE_PRESETS.find((x) => x.id === p.draft.presetId);
              return (
                <li key={p.id} className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={on ? "toolkit" : "outline"}
                    aria-pressed={on}
                    onClick={() => onPickCustom(p)}
                    className="h-auto min-w-0 flex-1 flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                  >
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-xs font-normal text-sub">
                      {base ? `${base.name} · ${KIND_WORD[base.kind]}` : "Quick Vote"}
                      {p.draft.question.trim() ? `: ${p.draft.question.trim()}` : ""}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="icon"
                    disabled={readOnly}
                    aria-label={`Delete the format “${p.name}”`}
                    onClick={() => onDeleteCustom(p)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
