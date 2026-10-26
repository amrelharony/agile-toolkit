"use client";

/**
 * The live room's kind-aware pieces, for the host's and the participant's
 * side alike: the answer form, the revealed results, a closed round's
 * results, its Markdown, and whether it has anything a tool could keep.
 * Each picks the scale, pair or allocation component by the round's kind,
 * so `HostVoteRoom` and `VoteJoinRoom` stay one flow for every kind.
 */

import { voteRoundMarkdown } from "@/lib/realtime/vote-room/aggregate";
import { allocationRoundMarkdown } from "@/lib/realtime/vote-room/allocation";
import { pairRoundMarkdown } from "@/lib/realtime/vote-room/pair";
import {
  isAllocationResult,
  isPairResult,
  type RoundDraft,
  type RoundResult,
} from "@/lib/realtime/vote-room/kinds";
import type { VoteRoom, VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { AllocationAnswerForm } from "./allocation-answer-form";
import { AllocationResults } from "./allocation-results";
import { PairAnswerForm } from "./pair-answer-form";
import { PairResults } from "./pair-results";
import { VoteAnswerForm } from "./vote-answer-form";
import { VoteResults } from "./vote-results";

/** The open round's title, whatever its kind; null before the first state. */
export function roomTitle(room: VoteRoom): string | null {
  return room.questionnaire?.title ?? room.pairSheet?.title ?? room.sheet?.title ?? null;
}

/** Whether the room knows what this round asks (the host's first state has arrived). */
export function roomHasRound(room: VoteRoom): boolean {
  return room.questionnaire !== null || room.pairSheet !== null || room.sheet !== null;
}

/** The revealed round's result, whatever its kind. */
export function roomResult(room: VoteRoom): RoundResult | null {
  return room.result ?? room.pairResult ?? room.allocationResult;
}

/**
 * Whether a closed round has totals a tool could keep: a scale or pair
 * round with every question or item withheld has none (each tool refuses
 * such a round); an allocation round always shows its totals.
 */
export function resultKeepable(r: RoundResult | null): boolean {
  if (!r) return false;
  if (isAllocationResult(r)) return true;
  if (isPairResult(r)) return r.items.some((x) => x.joint !== null);
  return r.questions.some((q) => q.distribution !== null);
}

/** The round as Markdown, by its kind. */
export function roundMarkdown(r: RoundResult): string {
  if (isAllocationResult(r)) return allocationRoundMarkdown(r);
  if (isPairResult(r)) return pairRoundMarkdown(r);
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
  if (room.sheet) {
    return (
      <AllocationAnswerForm sheet={room.sheet} onSubmit={onSubmit} submitLabel={submitLabel} />
    );
  }
  if (room.pairSheet) {
    return <PairAnswerForm sheet={room.pairSheet} onSubmit={onSubmit} submitLabel={submitLabel} />;
  }
  if (room.questionnaire) {
    return (
      <VoteAnswerForm
        questionnaire={room.questionnaire}
        onSubmit={onSubmit}
        submitLabel={submitLabel}
      />
    );
  }
  return null;
}

/** The revealed round's results, by its kind; null while nothing is revealed. */
export function LiveRoundResults({
  room,
  focusHeading = false,
}: {
  room: VoteRoom;
  focusHeading?: boolean;
}) {
  if (room.sheet && room.allocationRevealed) {
    return (
      <AllocationResults
        sheet={room.sheet}
        revealed={room.allocationRevealed}
        minN={room.minN}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (room.pairSheet && room.pairRevealed) {
    return (
      <PairResults
        sheet={room.pairSheet}
        revealed={room.pairRevealed}
        minN={room.minN}
        ballots={room.ballots}
        focusHeading={focusHeading}
      />
    );
  }
  if (room.questionnaire && room.revealed) {
    return (
      <VoteResults
        questionnaire={room.questionnaire}
        revealed={room.revealed}
        minN={room.minN}
        ballots={room.ballots}
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
