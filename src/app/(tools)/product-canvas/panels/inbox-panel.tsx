"use client";

/**
 * The idea inbox, in place of the canvas list: a quick capture (the idea,
 * who asked, where from, with the open ideas that look like it while it is
 * typed), the ideas by status, most asked for first, each with its demand,
 * "These look alike" with a Merge for each pair (with Undo), and a straw
 * poll in Quick Vote over the open ideas, numbered so the room's totals
 * can be read back here. "Include who asked" decides whether the export
 * names the requesters.
 *
 * The team's ideas and the example's never mix: look-alikes and merges stay
 * inside each.
 */

import Link from "next/link";
import { Merge, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { IDEA_STATUS_LABEL, possibleDuplicates } from "@/lib/product-canvas/fields";
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABEL,
  inboxCounts,
  inboxView,
  isOpenIdea,
  mergeIdeas,
  type InboxFilter,
} from "@/lib/product-canvas/intake";
import { canvasPoll } from "@/lib/product-canvas/poll";
import type { ProductCanvas } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { shortText } from "../boxes";
import { NewCanvasForm, type NewCanvasValues } from "../new-canvas-form";

export interface InboxWriter {
  /** Every canvas as the store holds it now. */
  all: () => ProductCanvas[];
  put: (rows: readonly ProductCanvas[]) => void;
  /** Log a change to `canvasId` (nothing for the example). */
  log: (canvasId: string, action: string, payload?: Record<string, unknown>) => void;
}

export function InboxPanel({
  canvases,
  selectedId,
  filter,
  withRequesters,
  onSelect,
  onFilter,
  onWithRequesters,
  onLog,
  writer,
}: {
  /** Every canvas (ideas are picked out). */
  canvases: readonly ProductCanvas[];
  selectedId: string | null;
  filter: InboxFilter;
  withRequesters: boolean;
  onSelect: (id: string) => void;
  onFilter: (filter: InboxFilter) => void;
  onWithRequesters: (on: boolean) => void;
  onLog: (values: NewCanvasValues) => void;
  writer: InboxWriter;
}) {
  const counts = inboxCounts(canvases);
  const shown = inboxView(canvases, filter);
  const team = canvases.filter((c) => !isExampleId(c.id));
  const open = inboxView(canvases, "open");
  // The poll is one world's: the team's open ideas, or the example's when there are none.
  const teamOpen = inboxView(team, "open");
  const pollIdeas = teamOpen.length > 0 ? teamOpen : open;
  const poll = canvasPoll(
    "Which idea should we look at first?",
    pollIdeas.map((c) => ({ id: c.id, title: c.title }))
  );
  const alike = [
    ...possibleDuplicates(inboxView(team, "open")),
    ...possibleDuplicates(
      inboxView(
        canvases.filter((c) => isExampleId(c.id)),
        "open"
      )
    ),
  ];

  const merge = (dupId: string, intoId: string) => {
    const all = writer.all();
    const dup = all.find((c) => c.id === dupId);
    const into = all.find((c) => c.id === intoId);
    if (!dup || !into) return;
    const world = all.filter((c) => isExampleId(c.id) === isExampleId(dup.id));
    const m = mergeIdeas(dup, into, world, new Date().toISOString());
    if (!m.ok) return;
    const saved = [dup, all.find((c) => c.id === m.root.id) ?? m.root];
    undoable({
      label: `Merged “${shortText(dup.title)}” into “${shortText(m.root.title)}”`,
      apply: () => {
        writer.put([m.root, m.duplicate]);
        writer.log(m.root.id, PRODUCT_CANVAS_ACTIONS.IDEAS_MERGED, {
          canvasId: m.root.id,
          merged: 1,
        });
      },
      revert: () => writer.put(saved),
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <NewCanvasForm
          format="idea"
          lockFormat
          ideas={team.filter(isOpenIdea)}
          onCreate={onLog}
          onOpenIdea={onSelect}
        />
      </div>

      <div role="group" aria-label="Ideas to show" className="flex flex-wrap gap-1.5">
        {INBOX_FILTERS.filter((f) => f === "open" || f === "all" || counts[f] > 0).map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={filter === f ? "toolkit" : "outline"}
            aria-pressed={filter === f}
            onClick={() => onFilter(f)}
          >
            {INBOX_FILTER_LABEL[f]}{" "}
            <span className="font-mono text-xs opacity-80">{counts[f]}</span>
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-sub">
          {counts.all === 0
            ? "No ideas yet. Log the first one above."
            : `No ${INBOX_FILTER_LABEL[filter].toLowerCase()} ideas.`}
        </p>
      ) : (
        <ul aria-label="Ideas" className="space-y-1.5">
          {shown.map((c) => {
            const current = selectedId === c.id;
            const key = poll.keys.get(c.id);
            const demand = c.intake?.demand ?? 1;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    current
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card hover:border-accent/40"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-text">
                      {key && (
                        <span className="mr-1.5 font-mono text-xs text-sub">
                          {key}
                          <span className="sr-only"> in the poll:</span>
                        </span>
                      )}
                      {c.title}
                    </span>
                    <span className="block text-xs text-sub">
                      {IDEA_STATUS_LABEL[c.intake?.status ?? "new"]}
                      {isExampleId(c.id) && " · example"}
                    </span>
                  </span>
                  <span
                    className="shrink-0 font-mono text-xs text-sub"
                    aria-label={`Asked for ${demand} ${demand === 1 ? "time" : "times"}`}
                  >
                    ×{demand}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {alike.length > 0 && (
        <section aria-labelledby="pc-inbox-alike" className="space-y-2">
          <h3 id="pc-inbox-alike" className="font-display text-base text-text">
            These look alike
          </h3>
          <ul className="space-y-2">
            {alike.flatMap((g) =>
              g.merge.map((dup) => (
                <li
                  key={`${g.keep.id}:${dup.id}`}
                  className="space-y-1.5 rounded-md border border-border p-2 text-sm"
                >
                  <p className="break-words text-text">
                    “{shortText(dup.title, 60)}” and “{shortText(g.keep.title, 60)}”
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    aria-label={`Merge “${dup.title}” into “${g.keep.title}”`}
                    onClick={() => merge(dup.id, g.keep.id)}
                  >
                    <Merge aria-hidden="true" />
                    Merge into the one asked for more
                  </Button>
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      {pollIdeas.length >= 2 && (
        <div className="space-y-1">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href={poll.href}>
              <Vote aria-hidden="true" />
              Vote in Quick Vote
            </Link>
          </Button>
          <p className="text-xs text-sub">
            Each open idea is a numbered option; the numbers show beside the titles above.
            {poll.left > 0 && ` ${poll.left} more aren’t in the poll.`}
          </p>
        </div>
      )}

      <label className="min-touch-coarse flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={withRequesters}
          onChange={(e) => onWithRequesters(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Include who asked in the export
      </label>
    </div>
  );
}
