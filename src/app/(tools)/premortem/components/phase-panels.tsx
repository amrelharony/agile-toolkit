"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Minus, Plus, ShieldAlert, Split } from "lucide-react";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { ScalePicker } from "@/components/shared/scale-picker";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { isExampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useStableOrder } from "@/hooks/use-stable-order";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { liveLink } from "@/lib/handoffs/registry";
import type { HandoffLinkStore } from "@/lib/handoffs/send";
import { useTeamRoster } from "@/lib/team/use-team-roster";
import { parseNumber } from "@/lib/utils/form";
import {
  TOP_N,
  causeScore,
  compareCauses,
  isRated,
  scoreText,
  topCauses,
  totalVotes,
  votesOf,
  type Premortem,
  type PremortemCause,
} from "../model";
import { IMPACT_HINT, IMPACT_STEPS, LIKELIHOOD_HINT, LIKELIHOOD_STEPS } from "../scales";
import { EXAMPLE_CAUSES_STAY, quoteCause, topLabel } from "../verdict";
import { CauseAddForm } from "./cause-add-form";
import {
  CauseText,
  OwnerField,
  RemoveCauseButton,
  RiskLink,
  TopBadge,
  causeName,
} from "./cause-parts";
import { SilentTimer } from "./silent-timer";

/** A premortem cause can become a risk. */
export const CAUSE_ROUTES = ["risk"] as const;

const keyOf = (c: PremortemCause) => c.id;

/** What the phase panels can do to a cause; the page owns the data, the history log and Undo. */
export interface CauseActions {
  edit: (id: string, next: { text: string; description?: string }) => void;
  remove: (id: string) => void;
  merge: (sourceId: string, targetId: string) => void;
  split: (id: string) => void;
  vote: (id: string, votes: number) => void;
  rate: (id: string, patch: { likelihood?: number | null; impact?: number | null }) => void;
  setPrevention: (id: string, text: string) => void;
  setOwner: (id: string, owner: string) => void;
  /** The cause's Risk Register links, read fresh, for its Send to… menu. */
  links: (id: string) => HandoffLinkStore;
  /** Whether the cause, or a duplicate grouped into it, is in the Risk Register now. */
  isSent: (c: PremortemCause) => boolean;
}

/** A focus target the page registers (`useReturnFocus().refFor`). */
type FocusRef = (el: HTMLElement | null) => void;

/* ── Write ───────────────────────────────────────────────────────────── */

/**
 * Silent writing: a quick add and an optional timer. The causes collapse to
 * a count while people write, so a shared screen doesn't anchor the room on
 * the first idea typed; the facilitator can show them, and moving on to
 * Group reveals them to everyone.
 */
export function WritePanel({
  premortem,
  onAdd,
  actions,
  addRef,
  exampleAction,
}: {
  premortem: Premortem;
  onAdd: (text: string) => void;
  actions: CauseActions;
  /** The cause field, so the page can focus it when a premortem starts. */
  addRef?: FocusRef;
  /** Offered beside "No causes yet." (Load an example). */
  exampleAction?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const listId = useId();
  const n = premortem.causes.length;
  return (
    <div className="space-y-4">
      <SilentTimer />
      <CauseAddForm onAdd={onAdd} inputRef={addRef} />
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" className="text-sm text-sub">
          {n === 0
            ? "No causes yet."
            : `${plural(n, "cause")} written${shown ? "" : ", hidden so nobody anchors on another's idea"}.`}
        </p>
        {n === 0 && exampleAction}
        {n > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={shown}
            aria-controls={listId}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? "Hide causes" : "Show causes"}
          </Button>
        )}
      </div>
      {shown && n > 0 && (
        <ul id={listId} aria-label="Causes written" className="divide-y divide-border">
          {premortem.causes.map((c) => (
            <li key={c.id} className="flex items-start gap-2 py-2">
              <CauseText cause={c} onEdit={(next) => actions.edit(c.id, next)} />
              <RemoveCauseButton cause={c} onRemove={() => actions.remove(c.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Group ───────────────────────────────────────────────────────────── */

/**
 * "Group with…": fold this cause into another as a duplicate. A menu, not a
 * select: a closed select on Windows changes on every arrow key, so a
 * keyboard user browsing the options grouped the cause into the first one
 * at once. Here nothing happens until a cause is picked.
 */
function GroupWith({
  cause,
  others,
  onMerge,
  triggerRef,
}: {
  cause: PremortemCause;
  others: readonly PremortemCause[];
  onMerge: (targetId: string) => void;
  triggerRef: FocusRef;
}) {
  // Picking a cause removes this row, trigger and all: the panel moves
  // focus to the cause it joined, so the menu mustn't send it back here.
  const picked = useRef(false);
  if (others.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          aria-label={`Group ${causeName(cause)} with another cause`}
        >
          Group with…
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 overflow-y-auto"
        onCloseAutoFocus={(e) => {
          if (picked.current) e.preventDefault();
          picked.current = false;
        }}
      >
        <DropdownMenuLabel className="text-xs font-medium text-sub">
          {`Group ${causeName(cause)} with`}
        </DropdownMenuLabel>
        {others.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => {
              picked.current = true;
              onMerge(o.id);
            }}
          >
            <span className="min-w-0 break-words">{o.text || "(untitled)"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Grouping: read the causes out, then fold each duplicate into the cause it
 * repeats. The duplicate's words stay under the cause ("Also: …") and Split
 * brings them back.
 */
export function GroupPanel({
  premortem,
  actions,
}: {
  premortem: Premortem;
  actions: CauseActions;
}) {
  const { causes } = premortem;
  // Grouping removes the row its menu was on, and Split removes the button
  // just pressed: focus goes to the cause that stays (its Split, or its
  // Group with…), never to the page body.
  const { refFor, returnTo } = useReturnFocus();
  if (causes.length === 0) return null;
  return (
    <ul aria-label="Causes to group" className="divide-y divide-border">
      {causes.map((c) => (
        <li key={c.id} className="space-y-2 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <CauseText cause={c} onEdit={(next) => actions.edit(c.id, next)} />
            <div className="flex items-center gap-1">
              <GroupWith
                cause={c}
                others={causes.filter((o) => o.id !== c.id)}
                triggerRef={refFor(`group:${c.id}`)}
                onMerge={(target) => {
                  actions.merge(c.id, target);
                  returnTo(`split:${target}`);
                }}
              />
              <RemoveCauseButton cause={c} onRemove={() => actions.remove(c.id)} />
            </div>
          </div>
          {c.merged && c.merged.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pl-3 text-xs text-sub">
              <span>Also: {c.merged.map((m) => `“${m.text || "(untitled)"}”`).join(", ")}</span>
              <Button
                ref={refFor(`split:${c.id}`)}
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1"
                aria-label={`Split ${causeName(c)}: bring back ${plural(c.merged.length, "grouped cause")}`}
                onClick={() => {
                  actions.split(c.id);
                  returnTo(`group:${c.id}`);
                }}
              >
                <Split aria-hidden="true" />
                Split
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Vote ────────────────────────────────────────────────────────────── */

/** Dots per person (optional guidance) and how many are placed. */
function VoteGuide({
  premortem,
  onDots,
}: {
  premortem: Premortem;
  onDots: (dots: number | undefined) => void;
}) {
  const roster = useTeamRoster();
  const [draft, setDraft] = useState(premortem.dotsPerPerson?.toString() ?? "");
  const [error, setError] = useState<string | undefined>();
  const placed = totalVotes(premortem.causes);
  const dots = premortem.dotsPerPerson;
  const budget = dots && roster.length > 0 ? dots * roster.length : null;

  const commit = () => {
    const n = parseNumber(draft);
    if (n === undefined) {
      setError(undefined);
      if (dots !== undefined) onDots(undefined);
      return;
    }
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      setError("Use a whole number from 1 to 99.");
      return;
    }
    setError(undefined);
    if (n !== dots) onDots(n);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
      <Field
        label="Dots per person"
        hint="Optional. Three is usual; nothing stops a fourth."
        error={error}
        className="sm:w-48"
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
          />
        )}
      </Field>
      <p className="text-sm text-sub sm:pb-2">
        {plural(placed, "dot")} placed
        {budget !== null
          ? ` of ${budget} (${plural(roster.length, "person", "people")} × ${dots})`
          : ""}
        .
      </p>
    </div>
  );
}

/**
 * Dot voting: plus and minus per cause, most votes first. The order holds
 * while votes come in (a row doesn't jump from under the next click) until
 * Re-sort; the top 3 are marked, and a tie at the cut-off is named.
 */
export function VotePanel({
  premortem,
  actions,
  onDots,
  onClearVotes,
  onRestoreVotes,
}: {
  premortem: Premortem;
  actions: CauseActions;
  onDots: (dots: number | undefined) => void;
  onClearVotes: () => void;
  onRestoreVotes: () => void;
}) {
  const { causes } = premortem;
  const { ordered, isStale, resort } = useStableOrder(causes, keyOf, compareCauses);
  const { top, tied } = topCauses(causes);
  const topIds = new Set(top.map((c) => c.id));
  const rankOf = new Map([...causes].sort(compareCauses).map((c, i) => [c.id, i + 1]));
  const placed = totalVotes(causes);
  if (causes.length === 0) return null;
  return (
    <div className="space-y-4">
      <VoteGuide key={premortem.id} premortem={premortem} onDots={onDots} />
      <ResortChip isStale={isStale} onResort={resort} what="Votes" />
      <ol aria-label="Causes, most votes first" className="divide-y divide-border">
        {ordered.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <span
              className="w-6 shrink-0 font-mono text-xs text-sub"
              aria-label={`Rank ${rankOf.get(c.id)}`}
            >
              {rankOf.get(c.id)}
            </span>
            <CauseText
              cause={c}
              withDescription={false}
              onEdit={(next) => actions.edit(c.id, next)}
            />
            {topIds.has(c.id) && placed > 0 && <TopBadge rank={rankOf.get(c.id) ?? 0} />}
            <span className="flex shrink-0 items-center gap-1">
              <IconButton
                label={`Take a vote from ${causeName(c)}`}
                icon={<Minus className="h-4 w-4" />}
                disabled={votesOf(c) === 0}
                onClick={() => actions.vote(c.id, votesOf(c) - 1)}
              />
              <span className="w-8 text-center font-mono text-sm text-text">
                {votesOf(c)}
                <span className="sr-only"> {votesOf(c) === 1 ? "vote" : "votes"}</span>
              </span>
              <IconButton
                label={`Add a vote to ${causeName(c)}`}
                icon={<Plus className="h-4 w-4" />}
                onClick={() => actions.vote(c.id, votesOf(c) + 1)}
              />
            </span>
          </li>
        ))}
      </ol>
      {tied.length > 0 && (
        <p className="text-sm text-warning">
          {`${listAnd(tied.map((c) => quoteCause(c, 40)))} tie at the cut-off. Add a vote to break the tie, or let likelihood × impact decide in the next step.`}
        </p>
      )}
      <ResetButton
        label="Clear votes"
        title="Clear every vote?"
        description={`The ${plural(placed, "dot")} placed so far will be removed. The causes stay.`}
        confirmLabel="Clear votes"
        doneLabel="Cleared the votes"
        disabled={placed === 0}
        onReset={onClearVotes}
        onUndo={onRestoreVotes}
      />
    </div>
  );
}

/* ── Act ─────────────────────────────────────────────────────────────── */

/**
 * "Send the top 3 to the Risk Register": one toast, one Undo. Held back,
 * with the reason beside it, until each unsent top cause is rated (the
 * register would otherwise fill a missing rating with a silent 3) and
 * written (a risk needs a title; the old Add Cause saved some blank).
 * Example causes are never sent: they would become real risks that no
 * Clear example removes.
 */
export function SendTop({
  premortem,
  isSent,
  onSend,
}: {
  premortem: Premortem;
  isSent: (c: PremortemCause) => boolean;
  onSend: (causes: PremortemCause[]) => void;
}) {
  const reasonId = useId();
  const { top } = topCauses(premortem.causes);
  if (premortem.causes.length === 0) return null;
  const unsent = top.filter((c) => !isSent(c));
  const pending = unsent.filter((c) => !isExampleId(c.id));
  const examples = unsent.length - pending.length;
  const blank = pending.filter((c) => !c.text.trim());
  const unrated = pending.filter((c) => !isRated(c));
  const label = topLabel(top.length || TOP_N);
  let reason: string;
  if (top.length === 0) {
    reason = `Vote, or rate likelihood and impact, to find ${label}.`;
  } else if (unsent.length === 0) {
    reason = `${top.length === 1 ? "The top cause is" : `All of the top ${top.length} are`} in the Risk Register.`;
  } else if (pending.length === 0) {
    reason = EXAMPLE_CAUSES_STAY;
  } else if (blank.length > 0) {
    reason = `Write the cause for ${listAnd(blank.map((c) => quoteCause(c, 40)))} first.`;
  } else if (unrated.length > 0) {
    reason = `Rate likelihood and impact for ${listAnd(unrated.map((c) => quoteCause(c, 40)))} first.`;
  } else {
    const already = top.length - unsent.length;
    reason = `Adds ${plural(pending.length, "risk")} with ${pending.length === 1 ? "its" : "their"} likelihood, impact and preventive action${
      already > 0 ? `; ${already} ${already === 1 ? "is" : "are"} there already` : ""
    }${examples > 0 ? "; example causes stay here" : ""}.`;
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
      <Button
        type="button"
        variant="toolkit"
        className="gap-2 self-start"
        disabled={pending.length === 0 || blank.length > 0 || unrated.length > 0}
        aria-describedby={reasonId}
        onClick={() => onSend(pending)}
      >
        <ShieldAlert aria-hidden="true" />
        {`Send ${label} to the Risk Register`}
      </Button>
      <p id={reasonId} className="text-xs text-sub">
        {reason}
      </p>
    </div>
  );
}

/** One cause in the Act phase: ratings, preventive action, owner, and where it went. */
function ActRow({
  cause: c,
  rank,
  isTop,
  actions,
  premortemId,
}: {
  cause: PremortemCause;
  rank: number;
  isTop: boolean;
  actions: CauseActions;
  premortemId: string;
}) {
  const sent = actions.isSent(c);
  // In the register through a duplicate grouped into it: its own menu
  // would make a second risk for the same cause.
  const viaDuplicate = sent && !liveLink(c.sentTo, "risk");
  const score = causeScore(c);
  const { getLinks, setLinks } = actions.links(c.id);
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="w-6 shrink-0 pt-1 font-mono text-xs text-sub" aria-label={`Rank ${rank}`}>
          {rank}
        </span>
        <CauseText cause={c} onEdit={(next) => actions.edit(c.id, next)} />
        <span className="flex shrink-0 flex-wrap items-center gap-2 pt-1">
          {isTop && <TopBadge rank={rank} />}
          {sent && <RiskLink />}
          <span className="text-xs text-sub">{plural(votesOf(c), "vote")}</span>
        </span>
        <RemoveCauseButton cause={c} onRemove={() => actions.remove(c.id)} />
      </div>
      {c.merged && c.merged.length > 0 && (
        <p className="text-xs text-sub">
          Also: {c.merged.map((m) => `“${m.text || "(untitled)"}”`).join(", ")}
        </p>
      )}
      {/* Every row repeats "Likelihood" and "Impact": the group says whose they are. */}
      <div
        role="group"
        aria-label={`Ratings for ${causeName(c)}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-start"
      >
        <ScalePicker
          label="Likelihood"
          size="sm"
          steps={LIKELIHOOD_STEPS}
          value={c.likelihood ?? null}
          onValueChange={(v) => actions.rate(c.id, { likelihood: v })}
          onClear={() => actions.rate(c.id, { likelihood: null })}
          hint={LIKELIHOOD_HINT}
        />
        <ScalePicker
          label="Impact"
          size="sm"
          steps={IMPACT_STEPS}
          value={c.impact ?? null}
          onValueChange={(v) => actions.rate(c.id, { impact: v })}
          onClear={() => actions.rate(c.id, { impact: null })}
          hint={IMPACT_HINT}
        />
        <p className="text-sm lg:pt-7">
          <span className="sr-only">Score: </span>
          <span className={score === null ? "text-sub" : "font-mono text-text"}>
            {scoreText(c)}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_14rem_auto] md:items-start">
        <BlurTextarea
          rows={1}
          value={c.preventiveAction ?? ""}
          onCommit={(v) => actions.setPrevention(c.id, v)}
          placeholder="What would prevent it?"
          aria-label={`Preventive action for ${causeName(c)}`}
          className="border-border bg-bg text-sm"
        />
        <OwnerField cause={c} onChange={(owner) => actions.setOwner(c.id, owner)} />
        <SendToMenu
          routes={CAUSE_ROUTES}
          // A missing rating would become the register's silent 3, and an
          // example cause never becomes a real risk.
          disabled={!isRated(c) || isExampleId(c.id) || viaDuplicate}
          item={{
            title: c.text,
            description: c.description,
            owner: c.owner,
            likelihood: c.likelihood,
            impact: c.impact,
            mitigation: c.preventiveAction,
            sourceRef: { tool: "premortem", id: c.id, doc: premortemId },
          }}
          sentTo={c.sentTo}
          getLinks={getLinks}
          onLinksChange={setLinks}
          className="h-9 justify-self-start"
        />
      </div>
    </li>
  );
}

/**
 * Acting on the causes: rate likelihood and impact (unset until chosen, never
 * a silent 3), agree a preventive action and an owner, and send the top 3
 * to the Risk Register. Sorted by votes, then likelihood × impact; the order
 * holds while ratings change until Re-sort.
 */
export function ActPanel({
  premortem,
  actions,
  onSendTop,
}: {
  premortem: Premortem;
  actions: CauseActions;
  onSendTop: (causes: PremortemCause[]) => void;
}) {
  const { causes } = premortem;
  const { ordered, isStale, resort } = useStableOrder(causes, keyOf, compareCauses);
  const { top } = topCauses(causes);
  const topIds = new Set(top.map((c) => c.id));
  const rankOf = new Map([...causes].sort(compareCauses).map((c, i) => [c.id, i + 1]));
  if (causes.length === 0) return null;
  return (
    <div className="space-y-4">
      <SendTop premortem={premortem} isSent={actions.isSent} onSend={onSendTop} />
      <ResortChip isStale={isStale} onResort={resort} what="Ratings" />
      <ol
        aria-label="Causes, most votes first, then likelihood × impact"
        className="divide-y divide-border"
      >
        {ordered.map((c) => (
          <ActRow
            key={c.id}
            cause={c}
            rank={rankOf.get(c.id) ?? 0}
            isTop={topIds.has(c.id)}
            actions={actions}
            premortemId={premortem.id}
          />
        ))}
      </ol>
    </div>
  );
}
