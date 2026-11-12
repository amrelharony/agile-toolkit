"use client";

import { useState } from "react";
import { MonitorUp, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeckCard } from "@/lib/card-decks/model";
import { CARDS_FRAME_KIND, cardsFrame } from "@/lib/realtime/show-room/frames/card-decks";
import type { ShowRoom } from "@/lib/realtime/show-room/use-show-room";

/** What a deal for the room came to. */
export type RoomDealResult =
  | { status: "dealt"; cards: DeckCard[] }
  /** No card left to deal this round. */
  | { status: "empty" }
  /** The room couldn't take the frame, so nothing was dealt. */
  | { status: "unsent" };

/**
 * The live room's controls, inside ShowRoomHost: deal straight onto
 * everyone's screen, or show the cards already on the table. What travels is
 * the deck's name and each card's text, title and hint (the frame parser
 * checks them); the deck's marks and the team's other decks are never sent.
 * A deal counts only once the room has taken it.
 */
export function RoomDeal({
  room,
  deckName,
  hand,
  handSize,
  onDealForRoom,
}: {
  room: Pick<ShowRoom, "show" | "status">;
  deckName: string;
  hand: readonly DeckCard[];
  handSize: number;
  /**
   * Deal `count` cards, calling `send` with them first: the deal goes on the
   * table only when `send` says the room took them.
   */
  onDealForRoom: (count: number, send: (cards: DeckCard[]) => boolean) => RoomDealResult;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const live = room.status === "live";

  const send = (cards: readonly DeckCard[]): boolean => {
    const frame = cardsFrame(deckName, cards);
    return frame !== null && room.show(CARDS_FRAME_KIND, frame);
  };
  const seen = (n: number) => `Everyone in the room sees ${n === 1 ? "it" : "them"} now.`;

  const deal = () => {
    const out = onDealForRoom(handSize, send);
    if (out.status === "empty") {
      setStatus("No cards left to deal this round. Shuffle to start again.");
    } else if (out.status === "unsent") {
      setStatus("Couldn't show that to the room, so nothing was dealt. Try again in a moment.");
    } else {
      const n = out.cards.length;
      setStatus(`${n === 1 ? "Dealt a card." : `Dealt ${n} cards.`} ${seen(n)}`);
    }
  };

  const showTable = () =>
    setStatus(
      send(hand)
        ? `Shown. ${seen(hand.length)}`
        : "Couldn't show that to the room. Try again in a moment."
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="toolkit" onClick={deal} disabled={!live} className="gap-1.5">
          <WalletCards className="h-4 w-4" aria-hidden="true" />
          {handSize === 1 ? "Deal a card for the room" : `Deal ${handSize} cards for the room`}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={showTable}
          disabled={!live || hand.length === 0}
          className="gap-1.5"
        >
          <MonitorUp className="h-4 w-4" aria-hidden="true" />
          Show the table to the room
        </Button>
      </div>
      <p role="status" className={status ? "text-sm text-sub" : "sr-only"}>
        {status ?? ""}
      </p>
    </div>
  );
}
