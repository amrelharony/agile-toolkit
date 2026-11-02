"use client";

import { useRef } from "react";
import Link from "next/link";
import { BarChart3, Link2Off, Trash2 } from "lucide-react";
import { BlurInput } from "@/components/shared/blur-fields";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { isExampleId } from "@/components/tool-frame/example-data";
import type { Okr } from "@/lib/stores/workspace-types";
import { normalizeQuarter } from "@/lib/roadmap/quarters";
import { krProgressText, okrProgressLabel, resolveLinkedOkrs } from "./okr-links";
import { focusAfterRemoval } from "./focus";

/** Whether the goal has key-result notes to show: anything but the old single blank row. */
export function hasNotes(notes: readonly string[]): boolean {
  return notes.length > 1 || (notes.length === 1 && notes[0].trim() !== "");
}

/**
 * Step 4: link the workspace OKRs this sprint moves. Key results typed into
 * the goal before it could link OKRs stay readable and editable as notes,
 * with a pointer to the OKR they belong to.
 */
export function OkrStep({
  okrs,
  okrIds,
  notes,
  onToggle,
  onUnlink,
  onEditNote,
  onRemoveNote,
}: {
  /** The OKRs to choose from (the workspace's, plus the example's while it shows). */
  okrs: readonly Okr[];
  okrIds: readonly string[] | undefined;
  notes: readonly string[];
  onToggle: (okrId: string) => void;
  onUnlink: (okrIds: string[]) => void;
  onEditNote: (index: number, value: string) => void;
  onRemoveNote: (index: number) => void;
}) {
  const linkedIds = new Set(okrIds ?? []);
  const { missing } = resolveLinkedOkrs(okrIds, okrs);
  const showNotes = hasNotes(notes);
  const stepRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLUListElement>(null);

  // The pressed button goes with its note: land on the next note's, or on
  // the OKR list once the last note is gone.
  const removeNote = (index: number) => {
    onRemoveNote(index);
    focusAfterRemoval(notesRef, "[data-remove-note]", index, () => {
      const step = stepRef.current;
      return (
        step?.querySelector<HTMLElement>('input[type="checkbox"]') ??
        step?.querySelector<HTMLElement>("a[href]")
      );
    });
  };

  return (
    <div ref={stepRef}>
      <h2 className="text-lg font-semibold text-text mb-2">Key Results</h2>
      <p className="text-sm text-sub mb-4">
        Link the OKRs this sprint moves. Their key results and progress stay in the{" "}
        <Link href="/okrs" className="text-accent hover:underline">
          OKRs tool
        </Link>
        , so the numbers live in one place.
      </p>

      {okrs.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          padding="md"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/okrs">Set OKRs</Link>
            </Button>
          }
        >
          No OKRs yet. Set them in the OKRs tool, then link the ones this sprint moves.
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="OKRs to link">
          {okrs.map((okr) => {
            const linked = linkedIds.has(okr.id);
            return (
              <li key={okr.id} className="rounded-lg border border-border bg-card p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={linked}
                    onChange={() => onToggle(okr.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text">
                      {okr.objective}
                      {isExampleId(okr.id) && (
                        <Badge variant="outline" className="ml-2 align-middle">
                          Example
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-sub">
                      {/* "Q4 2026" (the old intent's form) reads as the OKR page's "2026 Q4". */}
                      {[normalizeQuarter(okr.quarter) || okr.quarter, okrProgressLabel(okr)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
                {linked && okr.keyResults.length > 0 && (
                  <ul className="ml-7 mt-2 space-y-1 text-xs text-sub" aria-label="Its key results">
                    {okr.keyResults.map((kr) => (
                      <li key={kr.id}>
                        <span className="text-text">{kr.title}</span>: {krProgressText(kr)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {missing.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-sub">
          <span>
            {missing.length === 1
              ? "One linked OKR no longer exists."
              : `${missing.length} linked OKRs no longer exist.`}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onUnlink(missing)}>
            <Link2Off className="mr-1 h-4 w-4" aria-hidden="true" />
            Unlink {missing.length === 1 ? "it" : "them"}
          </Button>
        </div>
      )}

      {showNotes && (
        <section className="mt-6" aria-labelledby="sprint-goal-notes">
          <h3 id="sprint-goal-notes" className="text-sm font-semibold text-text">
            Key-result notes
          </h3>
          <p className="mt-1 mb-3 text-xs text-sub">
            Typed here before a goal could link OKRs. They stay as notes; link the OKR each one
            belongs to{" "}
            {okrs.length === 0 ? (
              <>
                after creating it in the{" "}
                <Link href="/okrs" className="text-accent hover:underline">
                  OKRs tool
                </Link>
              </>
            ) : (
              "above"
            )}
            , then delete the note.
          </p>
          <ul ref={notesRef} className="space-y-3" aria-label="Key-result notes">
            {notes.map((note, i) => (
              // Notes are plain strings with no id and never re-sort, so the index is stable.
              <li key={i} className="flex gap-2">
                <BlurInput
                  aria-label={`Key-result note ${i + 1}`}
                  value={note}
                  onCommit={(v) => onEditNote(i, v)}
                  className="flex-1 bg-card border-border text-text placeholder:text-sub focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
                />
                <IconButton
                  label={`Remove key-result note ${i + 1}`}
                  icon={<Trash2 className="w-4 h-4" />}
                  onClick={() => removeNote(i)}
                  data-remove-note=""
                  className="min-touch-coarse text-sub hover:text-danger hover:bg-danger/10 shrink-0"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
