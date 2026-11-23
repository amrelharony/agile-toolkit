"use client";

import { useState } from "react";
import Link from "next/link";
import { BookPlus, Scissors, Send, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { VERDICT_LABEL, suggestedVerdict } from "@/lib/example-mapping/model";
import { pollLinkHref } from "@/lib/quick-vote/link";
import {
  EXAMPLE_MAP_VERDICTS,
  type ExampleMap,
  type ExampleMapRule,
  type ExampleMapVerdict,
  type Story,
} from "@/lib/stores/workspace-types";

/** The poll "Ask the room" opens in Quick Vote. */
export const READY_POLL = {
  question: "Is this story ready to build?",
  options: ["Ready", "Not yet: open questions", "Split it first"],
} as const;

const NO_VERDICT = "none";
type VerdictChoice = ExampleMapVerdict | typeof NO_VERDICT;

/**
 * Deciding: the verdict (the map's signals suggest one; the team decides),
 * "Ask the room" through a Quick Vote poll, then what to do with the
 * cards. A map of a backlog story sends its rules and examples to that
 * story; a typed story is added to the backlog first. With two or more
 * rules, picked rules can become stories of their own ("Split by rule").
 */
export function DecidePanel({
  map,
  story,
  sendBlocked,
  splitHref,
  onVerdict,
  onSend,
  onAddToBacklog,
  onSplit,
}: {
  map: ExampleMap;
  /** The backlog story it maps, while it exists. */
  story: Story | undefined;
  /** Why nothing can be sent (the example), or null. */
  sendBlocked: string | null;
  /** Where a rule's split story is, while it exists. */
  splitHref: (rule: ExampleMapRule) => string | null;
  onVerdict: (v: ExampleMapVerdict | null) => void;
  onSend: () => void;
  onAddToBacklog: () => void;
  /** Make stories of the picked rules; returns how many were made. */
  onSplit: (ruleIds: string[]) => number;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const suggested = suggestedVerdict(map);
  const splittable = map.rules.filter((r) => !splitHref(r));
  const pickedLive = picked.filter((id) => splittable.some((r) => r.id === id));
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => (on ? [...p.filter((x) => x !== id), id] : p.filter((x) => x !== id)));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ToggleGroup<VerdictChoice>
          label="Verdict"
          value={map.verdict ?? NO_VERDICT}
          onValueChange={(v) => onVerdict(v === NO_VERDICT ? null : v)}
          options={[
            ...EXAMPLE_MAP_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] })),
            { value: NO_VERDICT, label: "Undecided" },
          ]}
        />
        {suggested && suggested !== map.verdict && (
          <p className="text-xs text-sub">The cards point to: {VERDICT_LABEL[suggested]}.</p>
        )}
        <Link
          href={pollLinkHref(READY_POLL.question, READY_POLL.options)}
          className="min-touch-coarse inline-flex items-center gap-1.5 rounded text-sm text-accent underline-offset-2 hover:underline"
        >
          <Vote className="h-4 w-4" aria-hidden="true" />
          Ask the room in Quick Vote
        </Link>
      </div>

      {sendBlocked ? (
        <p className="text-sm text-sub">{sendBlocked}</p>
      ) : (
        <div className="space-y-3">
          {story ? (
            <div className="space-y-1">
              <Button type="button" onClick={onSend} disabled={map.rules.length === 0}>
                <Send aria-hidden="true" />
                Send to the story
              </Button>
              <p className="text-xs text-sub">
                The rules join “{story.title}”&apos;s acceptance criteria, and the Given, When, Then
                examples its scenarios. Each goes once, with Undo.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Button type="button" variant="outline" onClick={onAddToBacklog}>
                <BookPlus aria-hidden="true" />
                Add to backlog
              </Button>
              <p className="text-xs text-sub">
                Adds “{map.title}” to the backlog and links this map to it, so the rules and
                examples can go to the story.
              </p>
            </div>
          )}

          {map.rules.length >= 2 && (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-text">Split by rule</legend>
              <p className="text-xs text-sub">
                Each picked rule becomes a backlog story of its own, with its examples as notes.
              </p>
              <ul className="space-y-1">
                {map.rules.map((r) => {
                  const href = splitHref(r);
                  return (
                    <li key={r.id} className="text-sm">
                      {href ? (
                        <span className="flex flex-wrap items-center gap-2 text-sub">
                          {r.text}: split already.
                          <Link
                            href={href}
                            className="min-touch-coarse inline-flex items-center rounded text-accent underline-offset-2 hover:underline"
                          >
                            Open
                          </Link>
                        </span>
                      ) : (
                        <label className="inline-flex min-h-8 items-center gap-2 text-text">
                          <input
                            type="checkbox"
                            checked={pickedLive.includes(r.id)}
                            onChange={(e) => toggle(r.id, e.target.checked)}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                          {r.text}
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pickedLive.length === 0}
                onClick={() => {
                  if (onSplit(pickedLive) > 0) setPicked([]);
                }}
              >
                <Scissors aria-hidden="true" />
                {pickedLive.length > 1
                  ? `Split ${pickedLive.length} rules into stories`
                  : "Split into a story"}
              </Button>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
