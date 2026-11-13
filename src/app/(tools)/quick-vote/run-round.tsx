"use client";

/**
 * Run the round set up above, three ways:
 *  - "Everyone on their own device": the vote kit's live room (anonymous,
 *    totals only, through `VoteRoundPanel`);
 *  - "One screen": count hands and type the totals (the kit's count entry
 *    for scales; Quick Vote's own for choice rounds); ESVP and the safety
 *    check count paper slips instead, never hands;
 *  - hold-up cards on each person's phone, with no room at all.
 *
 * One `VoteRoundPanel` stays mounted whatever the format, so an open room
 * survives a change of format: its next round asks the new one. A room's
 * answer threshold is fixed when it opens (the kit's rule), so a format
 * that needs more answers than the open room shows from (ESVP, the safety
 * check: 5) isn't handed to it; the host is told to open a room for it.
 * Only this panel's own room counts (the kit's `onLiveChange`): a room
 * another tool or tab has open never takes Quick Vote's rounds.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Calculator, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoteRoundPanel, type VoteRoundPanelProps } from "@/components/collab/vote-room";
import type { RoundResult } from "@/lib/realtime/vote-room/kinds";
import { useVoteRoomsAvailable } from "@/lib/realtime/vote-room/use-vote-room";
import type { ChoiceRoundResult } from "@/lib/realtime/vote-room/choice";
import { DEFAULT_MIN_N, presetMinN } from "@/lib/quick-vote/draft";
import { setQuickVoteRoom } from "@/lib/quick-vote/live-room";
import { readSheetId, type QuickVoteRound } from "@/lib/quick-vote/sheets";
import type { QuickVotePreset } from "@/lib/quick-vote/presets";
import { CountHands } from "./count-hands";
import { HoldUpCards, type CardAnswer } from "./hold-up-cards";

/**
 * The live room this page hosts: the answers it shows results from (fixed
 * when it opened), or null while none is open. Shared with Amr's
 * start_round through lib/quick-vote/live-room.
 */
export function usePageRoom(): {
  roomMinN: number | null;
  onLiveChange: (room: { minN: number } | null) => void;
} {
  const [roomMinN, setRoomMinN] = useState<number | null>(null);
  const onLiveChange = useCallback((room: { minN: number } | null) => {
    setRoomMinN(room ? room.minN : null);
    setQuickVoteRoom(room);
  }, []);
  // The page went: so did its room.
  useEffect(() => () => setQuickVoteRoom(null), []);
  return { roomMinN, onLiveChange };
}

export interface RunRoundProps {
  preset: QuickVotePreset;
  /** The round as the kit takes it, or null while the form is incomplete. */
  round: QuickVoteRound | null;
  /** Why the round can't run yet (the form's first problem, the example), or null. */
  blockedReason: string | null;
  /** The kit's Save round: totals only. An undo, or false when nothing was stored. */
  onSave: (result: RoundResult) => false | (() => void);
  /** Count hands' Save round (no kit toast): true when stored; `onUndone` runs on its Undo. */
  onSaveCounts: (result: ChoiceRoundResult, onUndone: () => void) => boolean;
  /** Hold-up cards opened. */
  onCards: () => void;
  readOnly: boolean;
}

export function RunRound({
  preset,
  round,
  blockedReason,
  onSave,
  onSaveCounts,
  onCards,
  readOnly,
}: RunRoundProps) {
  const availability = useVoteRoomsAvailable();
  const [counting, setCounting] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const formatMinN = presetMinN(preset);
  // ESVP and the safety check: each answer stays anonymous, so no hands or
  // cards held up, only paper slips the host collects and counts (the
  // kit's count entry too, for the safety check's scale).
  const anonymous = formatMinN > DEFAULT_MIN_N;
  const { roomMinN, onLiveChange } = usePageRoom();
  const need = roomMinN ?? formatMinN;
  // A stricter format waits for a room of its own.
  const tooFewForRoom = roomMinN !== null && formatMinN > roomMinN;
  const roundForPanel = tooFewForRoom ? null : round;

  const renderResults = (result: RoundResult): ReactNode => (
    <RoundNote preset={preset} result={result} />
  );
  const choice = round?.kind === "choice" ? round.sheet : null;
  const liveOff = !availability.available && availability.reason !== "auth-pending";

  const base = {
    tool: "quick-vote" as const,
    toolName: "Quick Vote",
    minN: need,
    // No round handed over either: an open room keeps asking its last one.
    blockedReason: tooFewForRoom
      ? `${preset.name} needs a live room of its own, one that shows results from ${formatMinN} answers.`
      : blockedReason,
    onSave,
    renderResults,
    onLiveChange,
    paperOnly: anonymous,
  };
  let panel: VoteRoundPanelProps;
  switch (preset.kind) {
    case "scale":
      panel = {
        ...base,
        kind: "scale",
        questionnaire: roundForPanel?.kind === "scale" ? roundForPanel.questionnaire : null,
      };
      break;
    case "choice":
      panel = {
        ...base,
        kind: "choice",
        sheet: roundForPanel?.kind === "choice" ? roundForPanel.sheet : null,
        oneScreen: {
          description: anonymous
            ? "Collect paper slips, so nobody's answer is seen, count them, then type the totals here."
            : "Count hands, or the cards people hold up, then type the totals here.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              aria-expanded={counting}
              onClick={() => setCounting((c) => !c)}
            >
              <Calculator aria-hidden="true" />
              {counting ? "Hide count entry" : anonymous ? "Count the slips" : "Count hands"}
            </Button>
          ),
        },
      };
      break;
    case "rank":
      panel = {
        ...base,
        kind: "rank",
        sheet: roundForPanel?.kind === "rank" ? roundForPanel.sheet : null,
      };
      break;
    case "number":
      panel = {
        ...base,
        kind: "number",
        sheet: roundForPanel?.kind === "number" ? roundForPanel.sheet : null,
      };
      break;
  }

  // Each card keeps its option's hint (ESVP's, the Roman vote's, value poker's meanings).
  const cardAnswers: CardAnswer[] =
    round?.kind === "scale"
      ? round.questionnaire.scale.points.map((p) => ({ text: p.label }))
      : round?.kind === "choice"
        ? round.sheet.options.map((o) =>
            o.hint ? { text: o.text, hint: o.hint } : { text: o.text }
          )
        : [];
  const cardsOk = preset.cards && cardAnswers.length > 0 && !blockedReason;

  return (
    <div className="space-y-4">
      {roomMinN !== null && (
        <p role="status" className="text-xs text-sub">
          {tooFewForRoom
            ? `${preset.name} shows results only from ${formatMinN} answers, and the live room you opened here shows them from ${roomMinN}, so its next round stays on the last one. End and close that room, then run a new one for ${preset.name}.`
            : need > formatMinN
              ? `The live room you opened here shows results from ${need} answers, as it was opened for a format that asks about people. Its next round asks what is set up above.`
              : "Your live room is open. Its next round asks what is set up above."}
        </p>
      )}
      <VoteRoundPanel {...panel} />
      {choice && !blockedReason && (counting || liveOff) && (
        <CountHands
          key={choice.id + choice.options.map((o) => o.text).join("|")}
          sheet={choice}
          minN={formatMinN}
          slips={anonymous}
          onSave={onSaveCounts}
          disabled={readOnly}
        />
      )}

      <div className="space-y-2 rounded-lg border border-border bg-surface-deep p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <Smartphone className="h-4 w-4 text-accent" aria-hidden="true" />
          Hold-up cards
        </h3>
        <p className="text-sm text-sub">
          {preset.cards
            ? `No room and no network: each person opens this page on their phone and sets up ${preset.name} too (for your own options, the same list), then opens the cards and picks one. They hold the phone up when you say show; count them, then type the totals above.`
            : anonymous
              ? `${preset.name} keeps each answer anonymous, and a card held up shows the room who picked what. Run it in a live room, or on paper slips you collect and count.`
              : `${preset.name} needs each person's own answer, so it runs in a live room rather than on cards.`}
        </p>
        {preset.cards && (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={!cardsOk}
            onClick={() => {
              setCardsOpen(true);
              onCards();
            }}
          >
            <Smartphone aria-hidden="true" />
            Open the cards
          </Button>
        )}
      </div>

      {preset.standing && (
        <p className="text-xs text-sub">
          A standing round: open it as the conversation starts and leave it open. Reveal when you
          want a read of the room, then start a new round to keep listening.
        </p>
      )}
      {preset.id === "perfection" && (
        <p className="text-xs text-sub">
          Then ask what would make it a 10:{" "}
          <Link href="/audience-wall" className="text-accent underline-offset-2 hover:underline">
            collect the answers on the Audience Wall
          </Link>
          , where people post without their names.
        </p>
      )}

      {round && (
        <HoldUpCards
          open={cardsOpen}
          onOpenChange={setCardsOpen}
          formatName={preset.name}
          title={round.kind === "scale" ? round.questionnaire.title : round.sheet.title}
          answers={cardAnswers}
          feelings={preset.id === "feelings"}
        />
      )}
    </div>
  );
}

/**
 * Under revealed results, before Save round: what saving leads to for the
 * format the round ran as (read from its sheet id: the host may have moved
 * on to another format since).
 */
function RoundNote({ preset, result }: { preset: QuickVotePreset; result: RoundResult }) {
  const kind = "kind" in result ? result.kind : "scale";
  const ranAs =
    readSheetId("questionnaireId" in result ? result.questionnaireId : result.sheetId).presetId ??
    preset.id;
  if (kind === "number") {
    return (
      <p className="text-xs text-sub">
        After you save the round, add the real answer to it under Results to see how close the
        guesses were.
      </p>
    );
  }
  if (ranAs === "value-poker" && kind === "choice") {
    return (
      <p className="text-xs text-sub">
        Saving the round changes nothing on the backlog. Agree the value, then save it to the item
        under Results, with Undo.
      </p>
    );
  }
  if (ranAs === "perfection" && kind === "scale") {
    return (
      <p className="text-xs text-sub">Next, ask what would make it a 10 on the Audience Wall.</p>
    );
  }
  return null;
}
