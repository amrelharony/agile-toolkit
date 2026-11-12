"use client";

/**
 * The live room's kind-aware pieces, for the host's and the participant's
 * side alike: the answer form, the revealed results, a closed round's
 * results, its Markdown, and whether it has anything a tool could keep.
 * Each picks the scale, pair, allocation, choice, rank or number component
 * by the round's kind, so `HostVoteRoom` and `VoteJoinRoom` stay one flow
 * for every kind.
 */

import { voteRoundMarkdown } from "@/lib/realtime/vote-room/aggregate";
import { allocationRoundMarkdown } from "@/lib/realtime/vote-room/allocation";
import { choiceRoundMarkdown } from "@/lib/realtime/vote-room/choice";
import { numberRoundMarkdown, numberSheetOf } from "@/lib/realtime/vote-room/number";
import { pairRoundMarkdown } from "@/lib/realtime/vote-room/pair";
import { VOTE_LIMITS, type VoteRoundKind } from "@/lib/realtime/vote-room/protocol";
import { rankRoundMarkdown } from "@/lib/realtime/vote-room/rank";
import {
  isAllocationResult,
  isChoiceResult,
  isNumberResult,
  isPairResult,
  isRankResult,
  specTitle,
  type RoundDraft,
  type RoundResult,
} from "@/lib/realtime/vote-room/kinds";
import type { VoteRoom, VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { AllocationAnswerForm } from "./allocation-answer-form";
import { AllocationResults } from "./allocation-results";
import { ChoiceAnswerForm } from "./choice-answer-form";
import { ChoiceResults } from "./choice-results";
import { NumberAnswerForm } from "./number-answer-form";
import { NumberResults } from "./number-results";
import { PairAnswerForm } from "./pair-answer-form";
import { PairResults } from "./pair-results";
import { RankAnswerForm } from "./rank-answer-form";
import { RankResults } from "./rank-results";
import { VoteAnswerForm } from "./vote-answer-form";
import { VoteResults } from "./vote-results";

/**
 * An allocation round's second threshold, said to the host before Reveal
 * (the panel and the open room): Reveal closes the round, so revealing at 3
 * or 4 answers loses who backed what, and the spread, for good.
 */
export function spreadNote(spreadNeed: number): string {
  return `Who gave each item something, and how the amounts were spread, show only from ${spreadNeed} answers, and Reveal closes the round: wait for ${spreadNeed} if you want them.`;
}

/**
 * The second threshold of a round of `kind`, said to the host before
 * Reveal, or null for a kind without one. Dot rounds show who put a dot
 * where, and number rounds their spread, only from `spreadNeed` answers.
 */
export function kindSpreadNote(
  kind: VoteRoundKind | null,
  spreadNeed: number,
  dots = false
): string | null {
  if (kind === "allocation") return spreadNote(spreadNeed);
  if (kind === "choice" && dots) {
    return `How many people put a dot on each option shows only from ${spreadNeed} answers, and Reveal closes the round: wait for ${spreadNeed} if you want it.`;
  }
  if (kind === "number") {
    return `The lowest, the highest and the spread show only from ${spreadNeed} answers, and Reveal closes the round: wait for ${spreadNeed} if you want them.`;
  }
  return null;
}

/** The round's second threshold note for the room's current round, or null. */
export function roomSpreadNote(room: VoteRoom): string | null {
  const need = Math.max(room.minN, VOTE_LIMITS.minNSpread);
  if (room.ballots >= need) return null;
  const dots = room.spec?.kind === "choice" && room.spec.sheet.mode === "dots";
  return kindSpreadNote(room.kind, need, dots);
}

/** The open round's title, whatever its kind; null before the first state. */
export function roomTitle(room: VoteRoom): string | null {
  return room.spec ? specTitle(room.spec) : null;
}

/** Whether the room knows what this round asks (the host's first state has arrived). */
export function roomHasRound(room: VoteRoom): boolean {
  return room.spec !== null;
}

/** The revealed round's result, whatever its kind. */
export function roomResult(room: VoteRoom): RoundResult | null {
  return room.roundResult;
}

/**
 * Whether a closed round has totals a tool could keep: a scale or pair
 * round with every question or item withheld has none (each tool refuses
 * such a round); the other kinds always show their totals.
 */
export function resultKeepable(r: RoundResult | null): boolean {
  if (!r) return false;
  if (isPairResult(r)) return r.items.some((x) => x.joint !== null);
  if ("kind" in r) return true;
  return r.questions.some((q) => q.distribution !== null);
}

/** The round as Markdown, by its kind. */
export function roundMarkdown(r: RoundResult): string {
  if (isAllocationResult(r)) return allocationRoundMarkdown(r);
  if (isPairResult(r)) return pairRoundMarkdown(r);
  if (isChoiceResult(r)) return choiceRoundMarkdown(r);
  if (isRankResult(r)) return rankRoundMarkdown(r);
  if (isNumberResult(r)) return numberRoundMarkdown(r);
  return voteRoundMarkdown(r);
}

/** The open round's form, by its kind. Callers key it by round id. */
export function RoundAnswerForm({
  room,
  onSubmit,
  submitLabel,
}: {
  room: VoteRoom;
  onSubmit: (draft: RoundDraft) => Promise<VoteSubmitResult>;
  submitLabel?: string;
}) {
  const spec = room.spec;
  if (!spec) return null;
  switch (spec.kind) {
    case "allocation":
      return (
        <AllocationAnswerForm sheet={spec.sheet} onSubmit={onSubmit} submitLabel={submitLabel} />
      );
    case "pair":
      return <PairAnswerForm sheet={spec.sheet} onSubmit={onSubmit} submitLabel={submitLabel} />;
    case "scale":
      return (
        <VoteAnswerForm
          questionnaire={spec.questionnaire}
          onSubmit={onSubmit}
          submitLabel={submitLabel}
        />
      );
    case "choice":
      return <ChoiceAnswerForm sheet={spec.sheet} onSubmit={onSubmit} submitLabel={submitLabel} />;
    case "rank":
      return <RankAnswerForm sheet={spec.sheet} onSubmit={onSubmit} submitLabel={submitLabel} />;
    case "number":
      return <NumberAnswerForm sheet={spec.sheet} onSubmit={onSubmit} submitLabel={submitLabel} />;
  }
}

/** The revealed round's results, by its kind; null while nothing is revealed. */
export function LiveRoundResults({
  room,
  focusHeading = false,
}: {
  room: VoteRoom;
  focusHeading?: boolean;
}) {
  const spec = room.spec;
  const revealed = room.revealedRound;
  if (!spec || !revealed) return null;
  if (spec.kind === "allocation" && revealed.kind === "allocation") {
    return (
      <AllocationResults
        sheet={spec.sheet}
        revealed={revealed.rows}
        minN={room.minN}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (spec.kind === "pair" && revealed.kind === "pair") {
    return (
      <PairResults
        sheet={spec.sheet}
        revealed={revealed.rows}
        minN={room.minN}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (spec.kind === "scale" && revealed.kind === "scale") {
    return (
      <VoteResults
        questionnaire={spec.questionnaire}
        revealed={revealed.rows}
        minN={room.minN}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (spec.kind === "choice" && revealed.kind === "choice") {
    return (
      <ChoiceResults
        sheet={spec.sheet}
        revealed={revealed.rows}
        minN={room.minN}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (spec.kind === "rank" && revealed.kind === "rank") {
    return (
      <RankResults
        sheet={spec.sheet}
        revealed={revealed.rows}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (spec.kind === "number" && revealed.kind === "number") {
    return (
      <NumberResults
        sheet={spec.sheet}
        revealed={revealed.value}
        minN={room.minN}
        focusHeading={focusHeading}
      />
    );
  }
  return null;
}

/** A closed round's results from its saved result alone (the room may be gone). */
export function SavedRoundResults({ result }: { result: RoundResult }) {
  if (isAllocationResult(result)) {
    return (
      <AllocationResults
        sheet={{
          id: result.sheetId,
          title: result.title,
          budget: result.budget,
          unit: result.unit,
          spendAll: result.spendAll,
          items: result.items.map((x) =>
            x.cap === undefined
              ? { id: x.id, text: x.text }
              : { id: x.id, text: x.text, cap: x.cap }
          ),
        }}
        revealed={result.items.map((x) => ({ total: x.total, backers: x.backers, bands: x.bands }))}
        minN={result.minN}
        ballots={result.ballots}
        spreadKnown={result.spreadKnown}
      />
    );
  }
  if (isPairResult(result)) {
    return (
      <PairResults
        sheet={{
          id: result.sheetId,
          title: result.title,
          prompts: result.prompts,
          answers: result.answers,
          items: result.items.map((x) => ({ id: x.id, text: x.text })),
        }}
        revealed={result.items.map((x) => ({ responses: x.responses, joint: x.joint }))}
        minN={result.minN}
        ballots={result.ballots}
      />
    );
  }
  if (isChoiceResult(result)) {
    return (
      <ChoiceResults
        sheet={{
          id: result.sheetId,
          title: result.title,
          mode: result.mode,
          limit: result.limit,
          options: result.options.map((x) => ({ id: x.id, text: x.text })),
        }}
        revealed={result.options.map((x) => ({ total: x.total, backers: x.backers }))}
        minN={result.minN}
        ballots={result.ballots}
      />
    );
  }
  if (isRankResult(result)) {
    return (
      <RankResults
        sheet={{
          id: result.sheetId,
          title: result.title,
          options: result.options.map((x) => ({ id: x.id, text: x.text })),
        }}
        revealed={result.options.map((x) => ({ points: x.points }))}
        ballots={result.ballots}
      />
    );
  }
  if (isNumberResult(result)) {
    return (
      <NumberResults
        sheet={numberSheetOf(result)}
        revealed={{ count: result.ballots, median: result.median, spread: result.spread }}
        minN={result.minN}
      />
    );
  }
  return (
    <VoteResults
      questionnaire={{
        id: result.questionnaireId,
        title: result.title,
        scale: result.scale,
        questions: result.questions.map((q) => ({ id: q.id, text: q.text })),
      }}
      revealed={result.questions.map((q) => ({
        responses: q.responses,
        distribution: q.distribution,
      }))}
      minN={result.minN}
      ballots={result.ballots}
    />
  );
}
