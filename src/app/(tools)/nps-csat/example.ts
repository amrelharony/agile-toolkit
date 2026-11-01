import { exampleId } from "@/lib/utils/example-id";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/** [day of the month, score, tags, verbatim]. */
type Answer = [day: number, score: number, tags: string, verbatim?: string];

/**
 * Three months of a shop's survey answers, oldest first: two full months
 * (enough answers to read without a warning) and a thin current month
 * that shows the small-sample warning. Checkout complaints pile up, the
 * theme the Next step points at; support improves.
 */
const MONTHS: { nps: Answer[]; csat: Answer[] }[] = [
  {
    nps: [
      [2, 9, "delivery", "Arrived a day early."],
      [3, 10, ""],
      [4, 6, "checkout", "The card form kept clearing itself."],
      [6, 8, ""],
      [8, 3, "support", "Waited 40 minutes for chat."],
      [9, 9, "pricing"],
      [11, 7, ""],
      [13, 10, "delivery"],
      [15, 5, "support", "Nobody answered my email."],
      [17, 9, ""],
      [20, 8, "pricing", "Fair, but shipping costs add up."],
      [23, 10, ""],
    ],
    csat: [
      [3, 4, "support"],
      [5, 5, ""],
      [7, 2, "support", "Three transfers to get an answer."],
      [10, 4, "delivery"],
      [12, 5, ""],
      [14, 3, "checkout"],
      [18, 4, ""],
      [21, 5, "support", "Sorted in one call."],
      [24, 4, ""],
      [26, 5, ""],
    ],
  },
  {
    nps: [
      [1, 10, ""],
      [3, 4, "checkout", "Payment failed twice, then went through."],
      [4, 9, "delivery"],
      [6, 9, "support", "Chat was quick this time."],
      [7, 6, "checkout, pricing", "Promo code wouldn't apply at checkout."],
      [9, 10, ""],
      [12, 8, ""],
      [14, 2, "checkout", "Lost my basket at the payment step."],
      [16, 9, ""],
      [18, 10, "delivery"],
      [21, 7, ""],
      [24, 9, "support"],
      [26, 10, ""],
    ],
    csat: [
      [2, 5, "support", "Friendly and fast."],
      [4, 4, ""],
      [6, 2, "checkout", "The app froze on the card step."],
      [9, 5, ""],
      [11, 4, "delivery"],
      [13, 5, "support"],
      [16, 3, ""],
      [19, 4, ""],
      [22, 5, ""],
      [25, 4, "support"],
      [27, 5, ""],
    ],
  },
  {
    nps: [
      [1, 9, ""],
      [2, 3, "checkout", "Card declined but the bank says it's fine."],
      [3, 10, "support"],
      [4, 8, ""],
    ],
    csat: [
      [1, 5, ""],
      [2, 1, "checkout", "Charged twice for one order."],
      [3, 4, "delivery"],
    ],
  },
];

/**
 * The example responses, every id an `example-` one ("Clear example"
 * removes exactly these): two months back to this month, with this month's
 * answers no later than today.
 */
export function buildExample(now: Date = new Date()): NpsResponse[] {
  const out: NpsResponse[] = [];
  MONTHS.forEach((month, m) => {
    const back = MONTHS.length - 1 - m;
    const year = now.getFullYear();
    const monthIndex = now.getMonth() - back;
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const cap = back === 0 ? now.getDate() : lastDay;
    const dayOf = (d: number) => todayLocalISO(new Date(year, monthIndex, Math.min(d, cap)));
    for (const kind of ["nps", "csat"] as const) {
      month[kind].forEach(([day, score, tags, verbatim], i) => {
        const list = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        out.push({
          id: exampleId(`nps-${m + 1}-${kind}-${i + 1}`),
          kind,
          date: dayOf(day),
          score,
          ...(verbatim ? { verbatim } : {}),
          ...(list.length > 0 ? { tags: list } : {}),
        });
      });
    }
  });
  return out;
}
