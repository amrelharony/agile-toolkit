import { exampleId } from "@/components/tool-frame/example-data";
import type { HillChart, HillCheckIn, HillScope } from "@/lib/stores/workspace-types";

const DAY = 86_400_000;

/**
 * A team building self-service refunds, four weeks in. Help text is done,
 * email receipts and the refund rules are nearly there, the admin screen
 * has just gone over the top, and fraud checks have barely started. The
 * payment provider API has sat at 30 for nine days, so it shows as stuck.
 * Four weekly check-ins show the climb. Every date counts back from `now`,
 * so it reads the same on any day; the ids mark it as the example, so it
 * is never sent anywhere or counted in the next steps.
 */
export function buildExample(now: Date): HillChart {
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const scope = (
    key: string,
    title: string,
    position: number,
    movedDaysAgo: number,
    note?: string
  ): HillScope => ({
    id: exampleId(`scope-${key}`),
    title,
    position,
    movedAt: ago(movedDaysAgo),
    ...(position >= 100 ? { doneAt: ago(movedDaysAgo) } : {}),
    ...(note ? { note } : {}),
  });
  const scopes: HillScope[] = [
    scope("rules", "Refund rules agreed", 80, 2, "Finance signed off the 30-day window."),
    scope(
      "api",
      "Payment provider API",
      30,
      9,
      "We still don't know how partial refunds come back from the provider."
    ),
    scope("email", "Email receipts", 90, 1),
    scope("admin", "Admin screen", 55, 3),
    scope("fraud", "Fraud checks", 15, 3),
    scope("help", "Help text", 100, 5),
  ];
  const at = (key: string, days: number, positions: number[], note: string): HillCheckIn => ({
    id: exampleId(`check-${key}`),
    at: ago(days),
    positions: scopes.map((s, i) => ({ scopeId: s.id, position: positions[i] })),
    note,
  });
  return {
    id: exampleId("hill-refunds"),
    title: "Self-service refunds",
    about: "Customers can refund an order themselves, without calling support.",
    scopes,
    checkIns: [
      at("1", 28, [10, 5, 10, 0, 0, 20], "Started. Everything is still a question."),
      at("2", 21, [35, 20, 40, 10, 0, 60], "Rules and receipts are taking shape."),
      at(
        "3",
        14,
        [60, 25, 70, 30, 5, 90],
        "Receipts are over the hill. The provider API is slow going."
      ),
      at(
        "4",
        7,
        [70, 30, 85, 45, 10, 95],
        "The provider API hasn't moved: we need an answer from them."
      ),
    ],
    createdAt: ago(28),
    updatedAt: ago(1),
  };
}
