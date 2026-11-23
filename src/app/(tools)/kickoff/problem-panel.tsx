"use client";

/**
 * Problem framing's two helpers, with no AI: the problem statement built
 * live from who, what, when and where, and what it costs (a template of our
 * own), which "Use it" writes into the statement; and "Add starter
 * questions", up to three How might we… lines from the answers. Both come
 * with Undo.
 */

import { Lightbulb, Quote } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import {
  answerOf,
  hmwStarters,
  itemsOf,
  newKickoffItemId,
  statementFrom,
  withSectionItems,
} from "@/lib/kickoff/model";
import { undoable } from "@/lib/utils/undoable";
import type { KickoffHandle } from "./kickoff-handle";

export function ProblemPanel({ handle }: { handle: KickoffHandle }) {
  const { kickoff: k, write, log } = handle;
  const announce = useAnnounce();
  const statement = statementFrom(k);
  const current = answerOf(k, "statement");
  const starters = hmwStarters(k);

  const useStatement = () => {
    if (!statement) return;
    const was = itemsOf(k, "statement");
    const id = newKickoffItemId();
    undoable({
      label: "Wrote the problem statement",
      kind: "success",
      apply: () => {
        const w = write((cur, now) =>
          withSectionItems(cur, "statement", [{ id, text: statement }], now)
        );
        if (w.ok) {
          log(KICKOFF_ACTIONS.ITEM_ADDED, { kickoffId: k.id, section: "statement" });
          announce("The problem statement is written.");
        }
      },
      revert: () => {
        // Only while it is still the line written here.
        write((cur, now) =>
          itemsOf(cur, "statement")[0]?.id === id
            ? withSectionItems(cur, "statement", was, now)
            : null
        );
      },
    });
  };

  const addStarters = () => {
    if (starters.length === 0) return;
    const added = starters.map((text) => ({ id: newKickoffItemId(), text }));
    const ids = new Set(added.map((a) => a.id));
    undoable({
      label: `Added ${added.length} ${added.length === 1 ? "question" : "questions"}`,
      kind: "success",
      apply: () => {
        const w = write((cur, now) =>
          withSectionItems(cur, "hmw", [...itemsOf(cur, "hmw"), ...added], now)
        );
        if (w.ok) {
          log(KICKOFF_ACTIONS.ITEM_ADDED, { kickoffId: k.id, section: "hmw" });
          announce(`Added ${added.length} How might we questions.`);
        }
      },
      revert: () => {
        write((cur, now) =>
          withSectionItems(
            cur,
            "hmw",
            itemsOf(cur, "hmw").filter((i) => !ids.has(i.id)),
            now
          )
        );
      },
    });
  };

  return (
    <SectionCard title="From the answers" icon={Quote} contentClassName="space-y-3">
      {statement ? (
        <>
          <p className="text-sm text-sub">
            The problem statement, from who, what, when and the cost:
          </p>
          <blockquote className="border-l-2 border-accent pl-3 text-sm text-text">
            {statement}
          </blockquote>
          {current === statement ? (
            <p className="text-xs text-sub" role="status">
              This is the statement now.
            </p>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={useStatement}>
              Use it
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm text-sub">
          Fill in who has the problem and what happens today, and the page writes the problem
          statement for you.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={starters.length === 0}
          onClick={addStarters}
        >
          <Lightbulb className="h-4 w-4" aria-hidden="true" />
          Add starter questions
        </Button>
        <span className="text-xs text-sub">
          {starters.length > 0
            ? `Up to ${starters.length} How might we… ${starters.length === 1 ? "question" : "questions"} from your answers.`
            : itemsOf(k, "hmw").length > 0
              ? "No new How might we… questions from these answers."
              : "Answer who, what, the cost or what good looks like to get How might we… questions."}
        </span>
      </div>
    </SectionCard>
  );
}
