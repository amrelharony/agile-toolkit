"use client";

import { useState } from "react";
import { MonitorUp, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeckCard } from "@/lib/card-decks/model";
import { CARDS_FRAME_KIND, cardsFrame } from "@/lib/realtime/show-room/frames/card-decks";
import type { ShowRoom } from "@/lib/realtime/show-room/use-show-room";

/**
 * The live room's controls, inside ShowRoomHost: deal straight onto
 * everyone's screen, or show the cards already on the table. Only the
 * card's text, title and hint travel (the frame parser checks them); the
 * deck's marks and the team's other decks never leave this browser.
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
  /** Deal `count` cards onto the table; returns what was dealt (none when the round is done). */
  onDealForRoom: (count: number) => DeckCard[];
}) {
  const [status, setStatus] = useState<string | null>(null);
  const live = room.status === "live";

  const send = (cards: readonly DeckCard[], what: string) => {
    const frame = cardsFrame(deckName, cards);
    if (!frame || !room.show(CARDS_FRAME_KIND, frame)) {
      setStatus("Couldn't show that to the room. Try again in a moment.");
      return;
    }
    setStatus(`${what} Everyone in the room sees ${cards.length === 1 ? "it" : "them"} now.`);
  };

  const deal = () => {
    const cards = onDealForRoom(handSize);
    if (cards.length === 0) {
      setStatus("No cards left to deal this round. Shuffle to start again.");
      return;
    }
    send(cards, cards.length === 1 ? "Dealt a card." : `Dealt ${cards.length} cards.`);
  };

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
          onClick={() => send(hand, "Shown.")}
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
