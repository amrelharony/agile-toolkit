"use client";

/**
 * Run the round set up above, three ways:
 *  - "Everyone on their own device": the vote kit's live room (anonymous,
 *    totals only, through `VoteRoundPanel`);
 *  - "One screen": count hands and type the totals (the kit's count entry
 *    for scales; Quick Vote's own for choice rounds);
 *  - hold-up cards on each person's phone, with no room at all.
 *
 * One `VoteRoundPanel` stays mounted whatever the format, so an open room
 * survives a change of format: its next round asks the new one. A room's
 * answer threshold is fixed when it opens (the kit's rule), so a format
 * that needs more answers than the open room shows from (ESVP, the safety
 * check: 5) isn't handed to it; the host is told to open a room for it.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Calculator, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoteRoundPanel, type VoteRoundPanelProps } from "@/components/collab/vote-room";
import type { RoundResult } from "@/lib/realtime/vote-room/kinds";
import { useVoteRoomsAvailable } from "@/lib/realtime/vote-room/use-vote-room";
import type { ChoiceRoundResult } from "@/lib/realtime/vote-room/choice";
import { inLiveVisitorRoom, subscribeLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { DEFAULT_MIN_N, presetMinN } from "@/lib/quick-vote/draft";
import { readSheetId, type QuickVoteRound } from "@/lib/quick-vote/sheets";
import type { QuickVotePreset } from "@/lib/quick-vote/presets";
import { CountHands } from "./count-hands";
import { HoldUpCards } from "./hold-up-cards";

/**
 * The answer threshold of the live room open in this browser, or null when
 * none is: the format's when a room opened while this page was here; the
 * kit's lowest (3) for one already open when the page opened (it may be in
 * another tab), so a stricter format is never handed to a room that would
 * show it sooner.
 */
export function useOpenRoomMinN(minN: number): number | null {
  const open = useSyncExternalStore(subscribeLiveVisitorRoom, inLiveVisitorRoom, () => false);
  const [roomMinN, setRoomMinN] = useState<number | null>(null);
  const was = useRef<boolean | null>(null);
  const minNRef = useRef(minN);
  minNRef.current = minN;
  useEffect(() => {
    const before = was.current;
    was.current = open;
    if (!open) setRoomMinN(null);
    else if (before === false) setRoomMinN(minNRef.current);
    else if (before === null) setRoomMinN(DEFAULT_MIN_N);
  }, [open]);
  return roomMinN;
}

export interface RunRoundProps {
  preset: QuickVotePreset;
  /** The round as the kit takes it, or null while the form is incomplete. */
  round: QuickVoteRound | null;
  /** Why the round can't run yet (the form's first problem, the example), or null. */
  blockedReason: string | null;
  /** The kit's Save round: totals only. An undo, or false when nothing was stored. */
  onSave: (result: RoundResult) => false | (() => void);
  /** Count hands' Save round (no kit toast): true when stored. */
  onSaveCounts: (result: ChoiceRoundResult) => boolean;
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
  const roomMinN = useOpenRoomMinN(formatMinN);
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
          description: "Count hands, or the cards people hold up, then type the totals here.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              aria-expanded={counting}
              onClick={() => setCounting((c) => !c)}
            >
              <Calculator aria-hidden="true" />
              {counting ? "Hide count entry" : "Count hands"}
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

  const cardAnswers =
    round?.kind === "scale"
      ? round.questionnaire.scale.points.map((p) => p.label)
      : round?.kind === "choice"
        ? round.sheet.options.map((o) => o.text)
        : [];
  const cardsOk = preset.cards && cardAnswers.length > 0 && !blockedReason;

  return (
    <div className="space-y-4">
      {roomMinN !== null && (
        <p role="status" className="text-xs text-sub">
          {tooFewForRoom
            ? `${preset.name} shows results only from ${formatMinN} answers, and the live room open in this browser shows them from ${roomMinN}. End that room, then run a new one for ${preset.name}.`
            : need > formatMinN
              ? `The live room open in this browser shows results from ${need} answers, as it was opened for a format that asks about people.`
              : "A live room is open in this browser. Its next round asks what is set up above."}
        </p>
      )}
      <VoteRoundPanel {...panel} />
      {choice && !blockedReason && (counting || liveOff) && (
        <CountHands
          key={choice.id + choice.options.map((o) => o.text).join("|")}
          sheet={choice}
          minN={formatMinN}
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
            ? "No room and no network: each person opens this page, picks a card, and holds the phone up when you say show. Count them, then type the totals above."
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
          , where people post anonymously.
        </p>
      )}

      {round && (
        <HoldUpCards
          open={cardsOpen}
          onOpenChange={setCardsOpen}
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
