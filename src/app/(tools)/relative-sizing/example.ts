import { bucketsFor } from "@/lib/relative-sizing/model";
import type { SavedSizingRound, SizingBoard, SizingItem } from "@/lib/relative-sizing/state";
import { exampleId } from "@/lib/utils/example-id";

/**
 * The example: "Checkout backlog (example)" on Fibonacci buckets, twelve
 * stories typed in (none from the backlog, so Save sizes writes nothing):
 * eight placed, one of them the anchor, three not placed, and one the team
 * keeps moving, which the room also put far apart. One saved live round.
 */
export function buildExample(now: Date): { board: SizingBoard; round: SavedSizingRound } {
  const at = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const buckets = bucketsFor("fibonacci");
  const b = (label: string) => buckets.find((x) => x.label === label)?.id ?? null;
  const item = (
    key: string,
    title: string,
    label: string | null,
    extra: Partial<SizingItem> = {}
  ) => ({
    id: exampleId(`card-${key}`),
    title,
    bucketId: label ? b(label) : null,
    moves: 0,
    ...extra,
  });
  const items: SizingItem[] = [
    item("login", "Sign in with an email link", "3"),
    item("guest", "Check out as a guest", "5", { moves: 1 }),
    item("card", "Pay with a saved card", "5"),
    item("promo", "Apply a promo code", "2"),
    item("address", "Save more than one address", "3"),
    item("receipt", "Email a receipt", "1"),
    item("wallet", "Pay with a phone wallet", "8"),
    item("refund", "Refund a payment from the admin page", "13", { moves: 1 }),
    item("split", "Split the bill between two cards", "8", {
      moves: 4,
      contested: true,
      room: { counts: [0, 0, 2, 0, 3, 1, 0], responses: 6, level: "spread" },
    }),
    item("tax", "Show tax per country", null),
    item("gift", "Buy a gift card", null),
    item("invoice", "Download an invoice as a PDF", null),
  ];
  const board: SizingBoard = {
    id: exampleId("sizing-checkout"),
    title: "Checkout backlog (example)",
    mode: "silent",
    bucketSet: "fibonacci",
    buckets,
    items,
    moveLimit: 3,
    anchorItemId: exampleId("card-card"),
    createdAt: at,
    updatedAt: at,
  };
  const round: SavedSizingRound = {
    roundId: exampleId("round-1"),
    boardId: board.id,
    closedAt: at,
    source: "live",
    ballots: 6,
    minN: 3,
    stories: [
      {
        itemId: exampleId("card-split"),
        title: "Split the bill between two cards",
        counts: [0, 0, 2, 0, 3, 1, 0],
        responses: 6,
      },
      {
        itemId: exampleId("card-wallet"),
        title: "Pay with a phone wallet",
        counts: [0, 0, 0, 1, 5, 0, 0],
        responses: 6,
      },
    ],
  };
  return { board, round };
}
