"use client";

import Link from "next/link";
import { CheckCircle2, Send, UserMinus, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionCard } from "@/components/shared/section-card";

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

/** "Not in today's standup" for one person (skip the day, nothing deleted). */
export function AwayButton({ name, onAway }: { name: string; onAway: (name: string) => void }) {
  return (
    <IconButton
      label={`Not in today's standup: ${name}`}
      icon={<UserMinus className="h-4 w-4" />}
      className="text-sub hover:text-text"
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
 * (fills the form) and "Not in today's standup".
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
                aria-label={`Post an update for ${name}`}
                onClick={() => onPostFor(name)}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Post for
              </Button>
              <AwayButton name={name} onAway={onAway} />
            </li>
          ))}
        </ul>
      )}
      <AwayList away={away} onBack={onBack} />
      {rosterSize > 0 && <TeamLink />}
    </SectionCard>
  );
}
