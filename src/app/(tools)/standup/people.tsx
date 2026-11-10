"use client";

import Link from "@/components/motion/transition-link";
import { CheckCircle2, Send, UserMinus, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionCard } from "@/components/shared/section-card";
import { byFocusKey, focusSoon } from "./focus";
import { personKey } from "./model";

/**
 * Removing someone from the standup used to remove them from the team
 * (and clear them as owner across the workspace). Now the standup only
 * marks people out for the day; the team itself is edited on the Team page.
 */
export function TeamLink() {
  return (
    <p className="text-xs text-sub">
      Joining or leaving the team? Change it on the{" "}
      <Link href="/team" className="text-accent underline-offset-2 hover:underline">
        Team page
      </Link>
      .
    </p>
  );
}

/** Focus keys (focus.ts) for a person's "Not in today's standup" and "Back in". */
export const awayKey = (name: string) => `away:${personKey(name)}`;
export const backKey = (name: string) => `back:${personKey(name)}`;

const neighbours = (list: readonly string[], name: string) => {
  const i = list.findIndex((n) => personKey(n) === personKey(name));
  return i < 0 ? [] : [list[i + 1], list[i - 1]].filter((n): n is string => Boolean(n));
};

/**
 * Where focus goes once `name` has left `list` (marked out of today's
 * standup, so their row is gone): the next person's button, else the one
 * before, else their own "Back in".
 */
export function focusAfterAway(list: readonly string[], name: string): void {
  focusSoon(byFocusKey(...neighbours(list, name).map(awayKey), backKey(name)));
}

/** After "Back in": their row in the list again, else the next one still out. */
export function focusAfterBack(away: readonly string[], name: string): void {
  focusSoon(byFocusKey(awayKey(name), ...neighbours(away, name).map(backKey)));
}

/** "Not in today's standup" for one person (skip the day, nothing deleted). */
export function AwayButton({ name, onAway }: { name: string; onAway: (name: string) => void }) {
  return (
    <IconButton
      label={`Not in today's standup: ${name}`}
      icon={<UserMinus className="h-4 w-4" />}
      className="text-sub hover:text-text"
      data-focus-key={awayKey(name)}
      onClick={() => onAway(name)}
    />
  );
}

/** The people out of today's standup, each with "Back in". */
export function AwayList({
  away,
  onBack,
}: {
  away: readonly string[];
  onBack: (name: string) => void;
}) {
  if (away.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-sub">Not in today&apos;s standup</p>
      <ul className="flex flex-wrap gap-2" aria-label="Not in today's standup">
        {away.map((name) => (
          <li
            key={name}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-3 pr-1 text-sm text-sub"
          >
            {name}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              aria-label={`Back in today's standup: ${name}`}
              data-focus-key={backKey(name)}
              onClick={() => onBack(name)}
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Back in
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Async mode: who on the team hasn't posted for the day, with "Post for"
 * (starts that person's update in the form) and "Not in today's standup".
 */
export function NotPostedPanel({
  rosterSize,
  notYet,
  away,
  onPostFor,
  onAway,
  onBack,
}: {
  rosterSize: number;
  notYet: readonly string[];
  away: readonly string[];
  onPostFor: (name: string) => void;
  onAway: (name: string) => void;
  onBack: (name: string) => void;
}) {
  const markAway = (name: string) => {
    onAway(name);
    focusAfterAway(notYet, name);
  };
  const markBack = (name: string) => {
    onBack(name);
    focusAfterBack(away, name);
  };
  return (
    <SectionCard title="Who hasn't posted" icon={Users} contentClassName="space-y-4">
      {rosterSize === 0 ? (
        <p className="text-sm text-sub">
          Add your team on the{" "}
          <Link href="/team" className="text-accent underline-offset-2 hover:underline">
            Team page
          </Link>{" "}
          to see who hasn&apos;t posted yet.
        </p>
      ) : notYet.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Everyone in today&apos;s standup has posted.
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Not posted yet">
          {notYet.map((name) => (
            <li
              key={name}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-text">{name}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
                // Starts with the visible text, so "click Post for" works by voice.
                aria-label={`Post for ${name}`}
                onClick={() => onPostFor(name)}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Post for
              </Button>
              <AwayButton name={name} onAway={markAway} />
            </li>
          ))}
        </ul>
      )}
      <AwayList away={away} onBack={markBack} />
      {rosterSize > 0 && <TeamLink />}
    </SectionCard>
  );
}
