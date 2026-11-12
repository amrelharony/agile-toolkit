"use client";

/**
 * A tool's entry point for an anonymous round (Health Check, Psych Safety,
 * Mood Tracker; Kano; Buy-a-Feature, the $100 Test):
 *
 *   <VoteRoundPanel tool="health-check" toolName="Health Check"
 *     questionnaire={q} minN={MIN_SAMPLE.anonymous} onSave={saveRound} />
 *   <VoteRoundPanel tool="kano-model" toolName="Kano survey"
 *     sheet={pairSheet} onSave={savePairRound} />
 *   <VoteRoundPanel tool="hundred-dollar-test" toolName="$100 Test"
 *     sheet={allocationSheet} onSave={saveAllocationRound} />
 *
 * The props are a union on the round's kind: `kind`, or the tool's usual
 * kind when unset (the only one for the six tools from before). A scale
 * round gives a `questionnaire` and gets a `VoteRoundResult`, a pair round
 * a `PairSheet` and a `PairRoundResult`, an allocation round an
 * `AllocationSheet` and an `AllocationRoundResult`. Choice, rank and number
 * rounds (Quick Vote) name their `kind` and give a `ChoiceSheet`,
 * `RankSheet` or `NumberSheet`; they run live only (no count entry: the
 * tool may pass its own `oneScreen` way instead).
 *
 * With live rooms available, the panel offers the two named ways to run
 * the round (components/collab/run-modes). "Everyone on their own device":
 * "Run a live round" asks for a name and consent, then mounts
 * `HostVoteRoom`; no key or channel exists before that. "One screen":
 * "Enter counts" shows the kind's count entry (`FacilitatorTally`,
 * `FacilitatorPair`, `FacilitatorAllocation`): counted hands or paper, same
 * totals, same minN rule, same `onSave`. When live rooms are off, the count
 * entry is the only option and shows on its own, with a one-line reason.
 *
 * Live rounds run for every host, the owner included (see
 * `vote-room/protocol.ts`); squad guests count by hand, and so does a
 * questionnaire or sheet the protocol can't carry (with the reason, before
 * any consent). An allocation sheet that can't even be counted by hand
 * (`allocationCountProblem`: a budget under 10, say) gets its reason and no
 * count entry. A tool can hold the round back with `blockedReason` (say,
 * Buy-a-Feature before its budgets are set): the reason shows instead of
 * the buttons. The panel writes nothing itself: `onSave` gets an
 * aggregates-only result when the host presses Save round. If it returns an
 * undo function, the kit shows "Saved the round" with Undo, and Undo makes
 * Save round available again; otherwise the tool says it saved. If it
 * returns false, it stored nothing (e.g. every question was withheld) and
 * says why itself: the kit shows nothing saved and keeps Save round.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Calculator, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signalGamification } from "@/lib/gamification/signal";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { LiveRoomLimits, RunModeChoice, type RunModeOption } from "@/components/collab/run-modes";
import { liveOnlyReason } from "@/components/collab/live-room-reasons";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import {
  VOTE_LIMITS,
  defaultRoundKind,
  questionnaireProblem,
  type AllocationRoomTool,
  type ChoiceRoomTool,
  type NumberRoomTool,
  type PairRoomTool,
  type Questionnaire,
  type RankRoomTool,
  type ScaleRoomTool,
  type VoteRoundKind,
} from "@/lib/realtime/vote-room/protocol";
import type { ChoiceRoundResult, ChoiceSheet } from "@/lib/realtime/vote-room/choice";
import type { NumberRoundResult, NumberSheet } from "@/lib/realtime/vote-room/number";
import type { RankRoundResult, RankSheet } from "@/lib/realtime/vote-room/rank";
import { effectiveMinN, type VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import {
  allocationCountProblem,
  sheetProblem,
  type AllocationRoundResult,
  type AllocationSheet,
} from "@/lib/realtime/vote-room/allocation";
import {
  pairSheetProblem,
  type PairRoundResult,
  type PairSheet,
} from "@/lib/realtime/vote-room/pair";
import {
  resultKind,
  wireSpec,
  type RoundInput,
  type RoundResult,
} from "@/lib/realtime/vote-room/kinds";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  useVoteRoomsAvailable,
  type VoteRoomsAvailability,
} from "@/lib/realtime/vote-room/use-vote-room";
import { toast } from "@/lib/utils/toast";
import { FacilitatorAllocation } from "./facilitator-allocation";
import { FacilitatorPair } from "./facilitator-pair";
import { FacilitatorTally } from "./facilitator-tally";
import { HostVoteRoom, type HostVoteSession } from "./host-vote-room";
import { kindSpreadNote } from "./round-views";
import type {
  SaveAllocationRound,
  SaveChoiceRound,
  SaveNumberRound,
  SavePairRound,
  SaveRankRound,
  SaveRound,
  SaveVoteRound,
} from "./save-round";

interface VoteRoundPanelBase {
  /** Shown in the consent title, e.g. "Health Check". */
  toolName: string;
  /**
   * Answers needed to show results. Never below the tool's floor
   * (`voteMinNFloor`: 5 for Psych Safety, 3 otherwise), which is also the default.
   */
  minN?: number;
  /**
   * Why the tool can't run a round right now, in one sentence (e.g. "Set
   * the players and their budget first."). Shown instead of the round's
   * buttons; null or absent when it can. A live room already open stays.
   */
  blockedReason?: string | null;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
  /**
   * Choice, rank and number rounds: the tool's own "One screen" way (they
   * have no count entry). Without it, the panel offers the live round on
   * its own.
   */
  oneScreen?: RunModeOption;
}

/** Health Check, Psych Safety, Mood Tracker (and Quick Vote): questions on one scale. */
export interface ScaleVoteRoundPanelProps extends VoteRoundPanelBase {
  tool: ScaleRoomTool;
  /** The tool's usual kind is scale; a tool that runs several kinds may say so. */
  kind?: "scale";
  /** Null while the tool has nothing to ask (e.g. no dimensions yet). */
  questionnaire: Questionnaire | null;
  /**
   * The host pressed Save round: totals only, once per round. Return an
   * undo function to get the kit's "Saved the round" toast with Undo, or
   * false when nothing was stored, so Save round stays available.
   */
  onSave: SaveVoteRound;
  /** Shown under the results, before Save round. */
  renderResults?: (result: VoteRoundResult) => ReactNode;
}

/** Kano (and Quick Vote's 2×2 polls): the same two questions about each item, kept as joint counts. */
export interface PairVoteRoundPanelProps extends VoteRoundPanelBase {
  tool: PairRoomTool;
  /** Needed for a tool whose usual kind isn't pair (Quick Vote). */
  kind?: "pair";
  /** Null while the tool has nothing to ask (no features yet). */
  sheet: PairSheet | null;
  /** As for scale rounds, with the pair round's joint totals. */
  onSave: SavePairRound;
  /** Shown under the results, before Save round (Kano: each feature's category). */
  renderResults?: (result: PairRoundResult) => ReactNode;
}

/** Buy-a-Feature, the $100 Test: a budget split across items, kept as per-item totals. */
export interface AllocationVoteRoundPanelProps extends VoteRoundPanelBase {
  tool: AllocationRoomTool;
  kind?: "allocation";
  /** Null while the tool has nothing to split (fewer than two items, say). */
  sheet: AllocationSheet | null;
  /** As for scale rounds, with the allocation round's totals. */
  onSave: SaveAllocationRound;
  /** Shown under the results, before Save round (Buy-a-Feature: what gets funded). */
  renderResults?: (result: AllocationRoundResult) => ReactNode;
}

/** Quick Vote's polls, multi-picks and dot voting: per-option totals. */
export interface ChoiceVoteRoundPanelProps extends VoteRoundPanelBase {
  tool: ChoiceRoomTool;
  kind: "choice";
  /** Null while the tool has nothing to ask (fewer than two options, say). */
  sheet: ChoiceSheet | null;
  onSave: SaveChoiceRound;
  renderResults?: (result: ChoiceRoundResult) => ReactNode;
}

/** Quick Vote's ranking: Borda points per option. */
export interface RankVoteRoundPanelProps extends VoteRoundPanelBase {
  tool: RankRoomTool;
  kind: "rank";
  sheet: RankSheet | null;
  onSave: SaveRankRound;
  renderResults?: (result: RankRoundResult) => ReactNode;
}

/** Quick Vote's "guess the number" and confidence: one number, median and spread. */
export interface NumberVoteRoundPanelProps extends VoteRoundPanelBase {
  tool: NumberRoomTool;
  kind: "number";
  sheet: NumberSheet | null;
  onSave: SaveNumberRound;
  renderResults?: (result: NumberRoundResult) => ReactNode;
}

export type VoteRoundPanelProps =
  | ScaleVoteRoundPanelProps
  | PairVoteRoundPanelProps
  | AllocationVoteRoundPanelProps
  | ChoiceVoteRoundPanelProps
  | RankVoteRoundPanelProps
  | NumberVoteRoundPanelProps;

/** The panel's round kind: the one it names, else its tool's usual one. */
function panelKind(p: VoteRoundPanelProps): VoteRoundKind | null {
  return p.kind ?? defaultRoundKind(p.tool);
}

function isScalePanel(p: VoteRoundPanelProps): p is ScaleVoteRoundPanelProps {
  return panelKind(p) === "scale";
}

function isPairPanel(p: VoteRoundPanelProps): p is PairVoteRoundPanelProps {
  return panelKind(p) === "pair";
}

function isAllocationPanel(p: VoteRoundPanelProps): p is AllocationVoteRoundPanelProps {
  return panelKind(p) === "allocation";
}

/** Kinds with a count entry ("Enter counts"): the six tools' kinds from before. */
function hasCountEntry(kind: VoteRoundKind | null): boolean {
  return kind === "scale" || kind === "pair" || kind === "allocation";
}

/** What the tool asks now, whatever its kind (null: nothing yet). */
function roundOf(p: VoteRoundPanelProps): RoundInput | null {
  return isScalePanel(p) ? p.questionnaire : (p as { sheet: RoundInput | null }).sheet;
}

/** Why the round can't be shared live, before any consent; null when it can. */
function roundProblem(p: VoteRoundPanelProps, round: RoundInput): string | null {
  if (isPairPanel(p)) return pairSheetProblem(round as PairSheet);
  if (isAllocationPanel(p)) return sheetProblem(round as AllocationSheet);
  if (isScalePanel(p)) return questionnaireProblem(round as Questionnaire);
  const kind = panelKind(p);
  if (!kind) return "This tool doesn't run live rounds.";
  const checked = wireSpec(kind, round);
  return checked.ok ? null : checked.problem;
}

export { liveOnlyReason };

/** Why live rounds are off here, in one line. */
export function unavailableReason(reason: VoteRoomsAvailability["reason"]): string | null {
  switch (reason) {
    case "flag-off":
      return "Live rounds are off on this site, so count hands or collect paper answers and enter the totals here.";
    case "no-realtime":
      return "Live rounds need the realtime service, which isn't set up here. Enter the totals instead.";
    case "no-crypto":
      return "This browser can't encrypt answers (it needs HTTPS and a current browser). Enter the totals instead.";
    case "guest":
      return "Guests can't host live rounds. Count hands or collect paper answers and enter the totals here.";
    default:
      return null;
  }
}

/** The kind's count entry: the same totals, minN rule and save as a live round. */
function CountEntry({
  props,
  round,
  need,
}: {
  props: VoteRoundPanelProps;
  round: RoundInput;
  need: number;
}) {
  if (isPairPanel(props)) {
    return (
      <FacilitatorPair
        tool={props.tool}
        sheet={round as PairSheet}
        minN={need}
        onSave={props.onSave}
        renderResults={props.renderResults}
      />
    );
  }
  if (isAllocationPanel(props)) {
    return (
      <FacilitatorAllocation
        tool={props.tool}
        sheet={round as AllocationSheet}
        minN={need}
        onSave={props.onSave}
        renderResults={props.renderResults}
      />
    );
  }
  if (isScalePanel(props)) {
    return (
      <FacilitatorTally
        tool={props.tool}
        questionnaire={round as Questionnaire}
        minN={need}
        onSave={props.onSave}
        renderResults={props.renderResults}
      />
    );
  }
  // Choice, rank and number rounds have no count entry.
  return null;
}

export function VoteRoundPanel(props: VoteRoundPanelProps) {
  const { tool, toolName, minN, crypto, blockedReason } = props;
  const availability = useVoteRoomsAvailable(crypto);
  const [consentOpen, setConsentOpen] = useState(false);
  const [live, setLive] = useState<HostVoteSession | null>(null);
  const [tally, setTally] = useState(false);
  const runRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const need = effectiveMinN(minN, tool);
  const round = roundOf(props);
  // A live room keeps the last round it had if the tool's goes away mid-round.
  const lastRound = useRef(round);
  if (round) lastRound.current = round;

  // The live room hands back any kind of result: each reaches the tool's own
  // typed save (and preview) only when it is of the tool's kind, which is
  // what makes the casts below sound.
  const { onSave, renderResults } = props;
  const kind = panelKind(props);
  const counted = hasCountEntry(kind);
  const saveAny = useCallback<SaveRound<RoundResult>>(
    (r) => (resultKind(r) === kind ? (onSave as SaveRound<RoundResult>)(r) : false),
    [kind, onSave]
  );
  const renderAny = useMemo(
    () =>
      renderResults
        ? (r: RoundResult) =>
            resultKind(r) === kind ? (renderResults as (x: RoundResult) => ReactNode)(r) : null
        : undefined,
    [kind, renderResults]
  );

  // After the room closes, put focus back on "Run a live round".
  useEffect(() => {
    if (live || !refocus.current) return;
    refocus.current = false;
    runRef.current?.focus();
  }, [live]);

  if (live && lastRound.current) {
    return (
      <HostVoteRoom
        key={live.code}
        tool={tool}
        toolName={toolName}
        session={live}
        round={lastRound.current}
        kind={kind ?? undefined}
        minN={need}
        onSave={saveAny}
        renderResults={renderAny}
        crypto={crypto}
        onClosed={() => {
          clearVisitorIdentity(live.code);
          refocus.current = true;
          setLive(null);
        }}
      />
    );
  }

  const reason = counted
    ? unavailableReason(availability.reason)
    : liveOnlyReason(availability.reason);
  const pending = availability.reason === "auth-pending";

  if (blockedReason) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
        {blockedReason}
      </p>
    );
  }

  if (!round) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
        {kind === "allocation"
          ? "Add at least two items to split between first, then run a round."
          : kind === "choice" || kind === "rank"
            ? "Add at least two options first, then run a round."
            : "Add something to ask first, then run a round."}
      </p>
    );
  }

  // A sheet the counting itself can't use: no live round and no count entry.
  const countProblem = isAllocationPanel(props)
    ? allocationCountProblem(round as AllocationSheet)
    : null;
  if (countProblem) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
        This round can&apos;t run, live or on paper: {countProblem}
      </p>
    );
  }

  // Checked before any consent: a round that can't start is never offered.
  const problem = roundProblem(props, round);

  if ((!availability.available && !pending) || problem) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-sub">
          {problem
            ? !counted
              ? `This round can't be shared live: ${problem}`
              : kind === "scale"
                ? `These questions can't be shared live: ${problem} Count hands or collect paper answers and enter the totals here.`
                : `This round can't be shared live: ${problem} Collect paper answers and enter them here.`
            : reason}
        </p>
        <CountEntry props={props} round={round} need={need} />
      </div>
    );
  }

  const spreadNeed = Math.max(need, VOTE_LIMITS.minNSpread);
  const dots = props.kind === "choice" && props.sheet?.mode === "dots";
  const spreadText = kindSpreadNote(kind, spreadNeed, dots);
  const ownDevice: RunModeOption = {
    description: (
      <>
        People answer on their own phones, anonymously. You see how many have answered, and the
        totals once {need} have.
        {spreadText && ` ${spreadText}`}
      </>
    ),
    action: (
      <Button
        ref={runRef}
        type="button"
        variant="toolkit"
        className="gap-1.5"
        disabled={pending}
        onClick={() => setConsentOpen(true)}
      >
        <Radio className="h-4 w-4" aria-hidden="true" />
        Run a live round
      </Button>
    ),
  };
  const oneScreen: RunModeOption | null = counted
    ? {
        description:
          kind === "scale"
            ? "Count hands or collect paper answers, then enter the totals here."
            : "Collect paper answers, then enter them here.",
        action: (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            aria-expanded={tally}
            onClick={() => setTally((t) => !t)}
          >
            <Calculator className="h-4 w-4" aria-hidden="true" />
            {tally ? "Hide count entry" : "Enter counts"}
          </Button>
        ),
      }
    : (props.oneScreen ?? null);

  return (
    <div className="space-y-3">
      {oneScreen ? (
        <RunModeChoice oneScreen={oneScreen} ownDevice={ownDevice} />
      ) : (
        <div className="space-y-2 rounded-lg border border-border bg-surface-deep p-3">
          <div className="text-sm text-sub">{ownDevice.description}</div>
          <LiveRoomLimits />
          <div className="flex flex-wrap items-center gap-2 pt-1">{ownDevice.action}</div>
        </div>
      )}
      {pending && (
        <p role="status" className="text-xs text-sub">
          Checking whether live rounds work here…
        </p>
      )}
      {tally && <CountEntry props={props} round={round} need={need} />}
      <VisitorRoomConsent
        open={consentOpen}
        onOpenChange={setConsentOpen}
        mode="start"
        variant="vote"
        toolName={toolName}
        onConfirm={(name) => {
          const code = newVisitorRoomCode();
          const identity = saveVisitorIdentity(code, name);
          if (!identity) {
            toast.error("Couldn't start the round. Try again.");
            return;
          }
          setConsentOpen(false);
          setTally(false);
          setLive({ code, identity, startedAt: Date.now() });
          signalGamification("invite-created", { toolId: tool });
        }}
      />
    </div>
  );
}
