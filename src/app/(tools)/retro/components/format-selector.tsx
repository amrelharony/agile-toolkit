"use client";

/**
 * Pre-board screen — pick a retro format (card grid) or jump straight in with
 * the Start/Stop/Continue quick-start. Shown when no board exists yet. A
 * first-time visitor (no past retros either) gets an empty state that offers
 * an example board.
 *
 * "Retro for" names the sprint the new board will look back on: the one a
 * ?sprint= link named, else the sprint whose retro window holds today. It is
 * shown, never applied behind the team's back, and can be changed or
 * cleared before a format is picked.
 *
 * When the facts of that sprint call for it (low mood, a missed goal, work
 * left unfinished: lib/retro/suggest), one format is marked as suggested,
 * with the reason in a line above the cards. It is a hint: nothing is picked
 * for the Scrum Master.
 *
 * Custom opens a form for the team's own columns (2 to 6 names). Starting
 * from it saves the format in this browser (custom-formats-store), and each
 * saved one shows as its own card after the built-in formats, with Delete
 * and Undo.
 */

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { MessagesSquare, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import {
  customFormatFrom,
  withSavedFormat,
  type CustomFormatDraft,
  type SavedCustomFormat,
} from "@/lib/retro/custom-format";
import { themed, tint } from "@/lib/utils/theme-color";
import { undoable } from "@/lib/utils/undoable";
import type { RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import { updateSavedFormats, useRetroFormatsStore, useSavedFormats } from "../custom-formats-store";
import { useFormatSuggestion } from "../use-format-suggestion";
import { CustomFormatEditor } from "./custom-format-editor";
import { PastRetros } from "./past-retros";
import { RetroSprintPicker } from "./retro-sprint-picker";

/** One format's card: its name is a real button stretched over the card. */
function FormatCard({
  format,
  onSelect,
  action,
  suggested = false,
}: {
  format: RetroFormat;
  onSelect: (format: RetroFormat) => void;
  /** A control of its own on the card (Delete), above the stretched button. */
  action?: ReactNode;
  /** Marked as the format suggested for this sprint (the reason is above the cards). */
  suggested?: boolean;
}) {
  const descId = `retro-format-${format.id}-desc`;
  const suggestedId = `retro-format-${format.id}-suggested`;
  return (
    // The format name is a real button, stretched over the card, so the
    // picker works from the keyboard and its accessible name is exactly its
    // visible label; the description is read as its description.
    <div className="group relative h-full">
      <Card
        className={`h-full bg-card group-hover:border-accent-cyan/40 transition-all duration-200 ${suggested ? "border-accent" : "border-border"}`}
      >
        <CardHeader className="pb-2">
          {suggested && (
            <span
              id={suggestedId}
              className="w-fit rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent"
            >
              Suggested for this sprint
            </span>
          )}
          <CardTitle className="text-sm font-bold text-text group-hover:text-accent transition-colors">
            <button
              type="button"
              onClick={() => onSelect(format)}
              aria-describedby={suggested ? `${suggestedId} ${descId}` : descId}
              className="text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-bg"
            >
              {format.name}
            </button>
          </CardTitle>
          <CardDescription id={descId} className="text-xs text-sub line-clamp-2">
            {format.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="flex flex-wrap gap-1">
            {format.columns.map((col) => (
              <span
                key={col.key}
                className="text-xs px-2 py-0.5 rounded-full border font-medium"
                style={{
                  color: themed(col.color),
                  borderColor: tint(col.color, 33),
                  backgroundColor: tint(col.color, 8),
                }}
              >
                {col.icon ? `${col.icon} ` : ""}
                {col.label}
              </span>
            ))}
          </div>
          {action && <div className="relative z-10 flex justify-end">{action}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

export function FormatSelector({
  onSelect,
  onLoadExample,
  past = [],
  onDeletePast,
  sprints,
  sprintId,
  onSprintChange,
}: {
  onSelect: (format: RetroFormat) => void;
  onLoadExample?: () => void;
  past?: RetroBoard[];
  onDeletePast?: (retro: RetroBoard) => void;
  /** Every sprint, newest first; without it the picker isn't shown. */
  sprints?: Sprint[];
  /** The sprint the new board will look back on. */
  sprintId?: string;
  onSprintChange?: (sprintId: string | undefined) => void;
}) {
  const sprintNames = useMemo(
    () => new Map((sprints ?? []).map((s) => [s.id, s.name] as const)),
    [sprints]
  );
  const firstRun = Boolean(onLoadExample) && past.length === 0;
  // One format the sprint's facts call for, if any: shown, never picked.
  const suggestion = useFormatSuggestion(sprintId);
  const suggestedFormat = suggestion
    ? retroFormats.find((f) => f.id === suggestion.formatId)
    : undefined;

  // ── Custom formats, kept in this browser ──
  useEffect(() => {
    const { persist } = useRetroFormatsStore;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: the picker starts with no saved formats */
    });
  }, []);
  const saved = useSavedFormats();
  const savedFormats = useMemo(
    () => saved.map((f) => ({ saved: f, format: customFormatFrom(f, f.id) })),
    [saved]
  );
  const [customOpen, setCustomOpen] = useState(false);
  const editorId = useId();

  const startCustom = useCallback(
    (values: CustomFormatDraft) => {
      let id = "";
      updateSavedFormats((list) => {
        const next = withSavedFormat(list, values);
        id = next.id;
        return next.list;
      });
      setCustomOpen(false);
      onSelect(customFormatFrom(values, id));
    },
    [onSelect]
  );

  const deleteSaved = useCallback((format: SavedCustomFormat) => {
    undoable({
      label: `Deleted the “${format.name}” format`,
      apply: () => updateSavedFormats((list) => list.filter((f) => f.id !== format.id)),
      // Back at the front: it was the last one this browser touched.
      revert: () =>
        updateSavedFormats((list) =>
          list.some((f) => f.id === format.id) ? [...list] : [format, ...list]
        ),
    });
  }, []);

  return (
    <ToolPageWrapper
      toolId="retro"
      title="Retro Board"
      description="Pick a format and run the retro on a shared screen: write cards, dot-vote, discuss the top items and agree actions."
      category="Ceremonies"
    >
      <div className="space-y-6">
        {firstRun && onLoadExample && (
          <EmptyState icon={MessagesSquare} action={<LoadExampleButton onLoad={onLoadExample} />}>
            No retro yet. Pick a format below to start the board, or load an example to see a
            finished one.
          </EmptyState>
        )}

        {sprints && onSprintChange && (
          <RetroSprintPicker sprints={sprints} sprintId={sprintId} onChange={onSprintChange} />
        )}

        <div className="space-y-1">
          <h2 className="text-lg font-display font-bold text-text">Choose a Format</h2>
          {suggestion && suggestedFormat && (
            <p className="text-sm text-sub">
              <span className="font-semibold text-text">
                Suggested for this sprint: {suggestedFormat.name}.
              </span>{" "}
              {suggestion.reason}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {retroFormats.map((fmt) => (
            <FormatCard
              key={fmt.id}
              format={fmt}
              onSelect={onSelect}
              suggested={fmt.id === suggestedFormat?.id}
            />
          ))}
          {savedFormats.map(({ saved: s, format }) => (
            <FormatCard
              key={format.id}
              format={format}
              onSelect={onSelect}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteSaved(s)}
                  aria-label={`Delete the ${s.name} format`}
                  className="min-touch-coarse h-7 gap-1.5 px-2 text-xs text-sub hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </Button>
              }
            />
          ))}
          {/* Custom: a form for the team's own columns, under the grid. */}
          <div className="group relative h-full">
            <Card className="h-full bg-card border-dashed border-border group-hover:border-accent-cyan/40 transition-all duration-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-text group-hover:text-accent transition-colors">
                  <button
                    type="button"
                    onClick={() => setCustomOpen((o) => !o)}
                    aria-expanded={customOpen}
                    aria-controls={customOpen ? editorId : undefined}
                    aria-describedby="retro-format-custom-desc"
                    className="text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-bg"
                  >
                    Custom
                  </button>
                </CardTitle>
                <CardDescription id="retro-format-custom-desc" className="text-xs text-sub">
                  Name your own columns, 2 to 6. Saved in this browser so you can use them again.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        {customOpen && (
          <CustomFormatEditor
            id={editorId}
            onStart={startCustom}
            onCancel={() => setCustomOpen(false)}
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => onSelect(retroFormats[0])}
            className="h-auto min-h-10 max-w-full whitespace-normal py-2 bg-accent-cyan text-bg font-bold hover:bg-accent-cyan/90 shadow-neon-cyan"
          >
            Quick Start: Start / Stop / Continue
          </Button>
        </div>

        {onDeletePast && (
          <PastRetros retros={past} onDelete={onDeletePast} sprintNames={sprintNames} />
        )}
      </div>
    </ToolPageWrapper>
  );
}
