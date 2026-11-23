/**
 * Kickoff's example: an Inception deck for a payments team's tap to pay,
 * the Checkout squad's Team Canvas, and a short problem framing. Every id is
 * an example id, so Clear example takes them all out, they are never sent,
 * and nothing counts them. No line holds a [placeholder].
 */

import type { Kickoff, KickoffItem } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

const DAY_MS = 86_400_000;

/** Lines for one section, with example ids "<prefix>-<n>". */
const lines = (prefix: string, texts: readonly string[]): KickoffItem[] =>
  texts.map((text, i) => ({ id: exampleId(`${prefix}-${i + 1}`), text }));

export function buildExample(now: Date = new Date()): Kickoff[] {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
  const day = (daysAgo: number) => at(daysAgo).slice(0, 10);

  const tapId = exampleId("kickoff-tap");
  const worryPartner = exampleId("tap-worries-1");
  const tap: Kickoff = {
    id: tapId,
    title: "Tap to pay on phones",
    format: "inception",
    brief:
      "Let shop owners take card payments by tapping the buyer's card on their own phone, so they can drop the separate card machine.",
    date: day(6),
    participants: ["Maya", "Omar", "Lena", "Ravi"],
    sections: {
      why: lines("tap-why", [
        "Shop owners pay a monthly fee for a card machine they'd rather not carry",
        "Stall holders lose sales when the machine's battery dies",
      ]),
      pitch: lines("tap-pitch", [
        "For small shop owners, tap to pay turns the phone they already have into a card reader, so every sale can be taken anywhere.",
      ]),
      headline: lines("tap-headline", ["Market stalls take cards with nothing but a phone"]),
      "in-scope": lines("tap-in", [
        "Take a contactless card payment on an Android phone",
        "Show the buyer a receipt on screen and by email",
        "Refund a tap payment from the phone",
      ]),
      "out-of-scope": lines("tap-out", [
        "iPhones in the first release",
        "Cash and invoices",
        "Tips and service charges",
      ]),
      unsure: lines("tap-unsure", ["Whether we charge a fee per tap or a monthly price"]),
      neighbours: lines("tap-neighbours", [
        "Support, for the questions a new way to pay brings",
        "The card partner, for certification",
        "Legal, for the terms shop owners accept",
      ]),
      worries: [
        {
          id: worryPartner,
          text: "The card partner's certification takes longer than five sprints",
          likelihood: 4,
          impact: 5,
        },
        {
          id: exampleId("tap-worries-2"),
          text: "Older phones can't read cards reliably",
          likelihood: 3,
          impact: 3,
        },
      ],
      size: lines("tap-size", ["About five sprints, maybe six with certification"]),
      needs: [
        {
          id: exampleId("tap-needs-1"),
          text: "A contact at the card partner who answers within a day",
          owner: "Omar",
          covers: worryPartner,
        },
        {
          id: exampleId("tap-needs-2"),
          text: "Three test phones of different ages",
          owner: "Lena",
        },
      ],
    },
    sliders: [
      {
        id: exampleId("tap-slider-date"),
        label: "Date",
        position: 1,
        note: "The market season starts in spring",
      },
      { id: exampleId("tap-slider-quality"), label: "Quality", position: 2 },
      { id: exampleId("tap-slider-cost"), label: "Cost", position: 3 },
      {
        id: exampleId("tap-slider-scope"),
        label: "Scope",
        position: 4,
        note: "Cut features, not the date",
      },
    ],
    slidersSetAt: at(6),
    status: "draft",
    createdAt: at(6),
    updatedAt: at(5),
  };

  const squad: Kickoff = {
    id: exampleId("kickoff-squad"),
    title: "Checkout squad",
    format: "team-canvas",
    brief: "A new squad formed from two teams to own checkout, from the basket to the receipt.",
    date: day(12),
    participants: ["Maya", "Omar", "Lena", "Ravi"],
    sections: {
      purpose: lines("squad-purpose", [
        "We're here to make paying the easiest part of shopping with us.",
      ]),
      people: [
        { id: exampleId("squad-people-1"), text: "Product Owner", owner: "Maya" },
        { id: exampleId("squad-people-2"), text: "Backend developer, payments", owner: "Omar" },
        { id: exampleId("squad-people-3"), text: "Mobile developer", owner: "Lena" },
        { id: exampleId("squad-people-4"), text: "Tester and Scrum Master", owner: "Ravi" },
      ],
      goals: lines("squad-goals", [
        "Fewer than one failed checkout in a hundred",
        "A new payment method live every quarter",
      ]),
      values: lines("squad-values", ["Buyers' money is never at risk", "We ship small and often"]),
      needs: [
        {
          id: exampleId("squad-needs-1"),
          text: "Reviews within half a day, so I'm not blocked",
          owner: "Omar",
        },
        {
          id: exampleId("squad-needs-2"),
          text: "Designs a sprint ahead of the build",
          owner: "Lena",
        },
      ],
      rules: lines("squad-rules", [
        "We pair on anything that touches payments",
        "We keep the standup to fifteen minutes",
        "We say when we're stuck within an hour",
      ]),
      strengths: lines("squad-strengths", [
        "Deep knowledge of the payment partners",
        "A tester in the team from day one",
      ]),
      weaknesses: [
        {
          id: exampleId("squad-weak-1"),
          text: "Only one of us knows the payout service",
          likelihood: 4,
          impact: 4,
        },
        {
          id: exampleId("squad-weak-2"),
          text: "Two of us are new to the codebase",
          likelihood: 3,
          impact: 2,
        },
      ],
    },
    status: "agreed",
    agreedAt: at(11),
    createdAt: at(12),
    updatedAt: at(11),
  };

  const refunds: Kickoff = {
    id: exampleId("kickoff-refunds"),
    title: "Refunds take a week",
    format: "problem-framing",
    date: day(2),
    sections: {
      who: lines("refunds-who", ["Buyers who return an item at a shop"]),
      what: lines("refunds-what", ["Their refund reaches their card about a week later"]),
      "when-where": lines("refunds-when", ["After a return at the counter"]),
      impact: lines("refunds-impact", ["Around forty support calls a week and lost repeat buyers"]),
      evidence: lines("refunds-evidence", [
        "Support logged 160 refund calls last month",
        "Refund settlement averages six days",
      ]),
      outcome: lines("refunds-outcome", ["Buyers see their money back the same day"]),
    },
    status: "draft",
    createdAt: at(2),
    updatedAt: at(1),
  };

  return [tap, squad, refunds];
}
