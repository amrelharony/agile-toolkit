/**
 * The example: a canvas per format (three ideas in the inbox, one merged
 * into another, and two Shape Up pitches, one out of time in Cycle 4), all
 * about the payments product of Product Goal's own example, under a
 * made-up name ("Tapline"). Who asked for an idea is a role, never a
 * person's name. It is
 * stored like the team's canvases (upserted on Load example, removed by
 * its example ids on Clear example), but never sent and never logged, and
 * Ask Amr reads Product Goal's example goal, vision and backlog with it,
 * never the team's own.
 */

import {
  EXAMPLE_STORY_TITLES,
  EXAMPLE_VISION,
  buildExample as buildGoalExample,
} from "@/app/(tools)/product-goal/example";
import { hypothesisSentence } from "@/lib/product-canvas/model";
import type { ProductCanvas, ProductCanvasItem, ProductGoal } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

export { EXAMPLE_STORY_TITLES, EXAMPLE_VISION };

/** The Product Goal an example canvas shows and drafts from: Product Goal's example. */
export function exampleGoal(now: Date = new Date()): ProductGoal {
  return buildGoalExample(now)[0];
}

const line = (
  key: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id: exampleId(key),
  text,
  ...over,
});

/** The example canvases, stamped around `now`. */
export function buildExample(now: Date = new Date()): ProductCanvas[] {
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const day = (days: number) => at(days).slice(0, 10);
  const stamp = (days: number) => ({ createdAt: at(days - 3), updatedAt: at(days) });

  const visionBoard: ProductCanvas = {
    id: exampleId("pc-vision"),
    format: "vision-board",
    title: "Tapline",
    sections: {
      vision: [line("pcv-vision", EXAMPLE_VISION)],
      who: [
        line("pcv-who-1", "Stall holders at weekend markets", { evidence: "fact" }),
        line("pcv-who-2", "Mobile hairdressers and cleaners", { evidence: "assumption" }),
      ],
      needs: [
        line("pcv-need-1", "Take a card when the buyer has no cash", { evidence: "fact" }),
        line("pcv-need-2", "See the day's takings before packing up", { evidence: "assumption" }),
      ],
      product: [
        line("pcv-what-1", "Payments on the phone they already carry"),
        line("pcv-what-2", "Money in the bank the next morning"),
      ],
      gains: [
        line("pcv-gain-1", "Shops with no card machine: from 40% to 70%", {
          evidence: "assumption",
        }),
      ],
      "pitch-name": [line("pcv-pitch-name", "Tapline")],
      "pitch-who": [line("pcv-pitch-who", "Stall holders at weekend markets")],
      "pitch-need": [line("pcv-pitch-need", "Sell to a buyer who has no cash")],
      "pitch-benefit": [line("pcv-pitch-benefit", "Take card payments on their own phone")],
      "pitch-today": [line("pcv-pitch-today", "A rented card machine, or cash only")],
      "pitch-difference": [
        line("pcv-pitch-diff", "Paying is seamless, with no extra device to rent"),
      ],
      questions: [line("pcv-q-1", "Will market organisers let stall holders take cards?")],
    },
    ...stamp(-6),
  };

  const valueProposition: ProductCanvas = {
    id: exampleId("pc-value"),
    format: "value-proposition",
    title: "Stall holders at weekend markets",
    sections: {
      customer: [line("pcp-customer", "Stall holders at weekend markets, on a busy Saturday")],
      jobs: [
        line("pcp-job-1", "Sell to every buyer who wants something", { evidence: "fact" }),
        line("pcp-job-2", "Close the day knowing what was sold", { evidence: "assumption" }),
      ],
      pains: [
        line("pcp-pain-1", "No phone signal in the market hall", { evidence: "fact" }),
        line("pcp-pain-2", "Buyers with no cash walk away", { evidence: "assumption" }),
        line("pcp-pain-3", "A rented card machine costs more than a slow month earns", {
          evidence: "assumption",
        }),
      ],
      gains: [
        line("pcp-gain-1", "Money in the bank by Monday", { evidence: "assumption" }),
        line("pcp-gain-2", "Fewer trips to the cash machine", { evidence: "assumption" }),
      ],
      offer: [
        line("pcp-offer-1", "Tap to pay on the stall holder's phone"),
        line("pcp-offer-2", "Payments taken with no signal, sent later"),
      ],
      eases: [
        line("pcp-ease-1", "Takes the payment with no signal and sends it later", {
          links: [exampleId("pcp-pain-1")],
        }),
        line("pcp-ease-2", "No machine to rent", { links: [exampleId("pcp-pain-3")] }),
      ],
      adds: [line("pcp-add-1", "Next-morning payout", { links: [exampleId("pcp-gain-1")] })],
      questions: [line("pcp-q-1", "How many buyers at a market carry no cash at all?")],
    },
    ...stamp(-4),
  };

  const users = "Stall holders in market halls";
  const benefit = "keep selling when the signal drops";
  const solution = "a queue that keeps payments until the phone is back online";
  const outcome = "more payments taken with no signal each week";
  const leanUx: ProductCanvas = {
    id: exampleId("pc-leanux"),
    format: "lean-ux",
    title: "Offline payments queue",
    sections: {
      problem: [
        line(
          "pcl-problem",
          "Market stall holders lose sales when a payment can't go through with no signal, and some have gone back to cash only."
        ),
      ],
      outcomes: [line("pcl-outcome-1", outcome)],
      users: [line("pcl-user-1", users, { evidence: "fact" })],
      benefits: [line("pcl-benefit-1", benefit, { evidence: "assumption" })],
      solutions: [line("pcl-solution-1", solution)],
      hypotheses: [
        line("pcl-hyp-1", hypothesisSentence({ users, benefit, solution, outcome }), {
          links: [
            exampleId("pcl-user-1"),
            exampleId("pcl-benefit-1"),
            exampleId("pcl-solution-1"),
            exampleId("pcl-outcome-1"),
          ],
        }),
      ],
      "learn-first": [
        line("pcl-learn-1", "Whether buyers trust a payment that shows as waiting", {
          links: [exampleId("pcl-hyp-1")],
        }),
      ],
      "smallest-test": [
        line("pcl-test-1", "Run the queue for 10 stall holders at one market for two weekends", {
          links: [exampleId("pcl-hyp-1")],
        }),
      ],
    },
    ...stamp(-2),
  };

  const prFaq: ProductCanvas = {
    id: exampleId("pc-prfaq"),
    format: "pr-faq",
    title: "Tapline for market stalls",
    sections: {
      headline: [
        line("pcf-headline", "Tapline lets market stall holders take cards on their phone"),
      ],
      subheading: [
        line(
          "pcf-sub",
          "Stall holders sell to every buyer, with no card machine to rent and no signal needed."
        ),
      ],
      "launch-date": [line("pcf-date", day(90))],
      summary: [
        line(
          "pcf-summary",
          "From today, stall holders at weekend markets can take card payments on the phone in their pocket. Payments taken with no signal wait on the phone and go through later."
        ),
      ],
      problem: [
        line(
          "pcf-problem",
          "Buyers carry less cash every year, and a rented card machine costs more than a quiet month earns. Stall holders lose sales they can see walking away."
        ),
      ],
      solution: [
        line(
          "pcf-solution",
          "Tapline turns the stall holder's phone into the card reader. It works in a market hall with no signal, and the money is in the bank the next morning."
        ),
      ],
      "customer-quote": [
        line(
          "pcf-customer",
          "“I used to lose three or four sales a Saturday. Now I just hold out my phone.”"
        ),
      ],
      "call-to-action": [
        line("pcf-cta", "Download Tapline and take your first payment in five minutes."),
      ],
      "customer-faq": [
        line("pcf-cq-1", "Does it work with no signal?", {
          detail: "Yes. The payment waits on the phone and goes through once it is back online.",
        }),
      ],
      "internal-faq": [
        line("pcf-iq-1", "What will it cost to build, and to keep running?", {
          promptId: "hq-cost",
          detail: "Two people for a quarter, then card fees we pass on at cost.",
        }),
        line("pcf-iq-2", "Who builds it, and what stops while they do?", { promptId: "hq-people" }),
        line("pcf-iq-3", "How will we know it worked, and by when?", {
          promptId: "hq-measure",
          detail: "Payments taken with no signal each week, measured from the second month.",
        }),
        line("pcf-iq-4", "What is the biggest risk, and how do we find out early?", {
          promptId: "hq-risk",
        }),
        line("pcf-iq-5", "What is the smallest version we could launch?", {
          promptId: "hq-smallest",
          detail: "Tap to pay with the offline queue, at one market, with no refunds yet.",
        }),
      ],
    },
    ...stamp(0),
  };

  // The idea inbox: requesters are roles, never people's names.
  const ideaTips: ProductCanvas = {
    id: exampleId("pc-idea-tips"),
    format: "idea",
    title: "Tips on the payment screen",
    sections: {
      problem: [
        line(
          "pci-tips-problem",
          "Buyers at food stalls want to leave a tip, and the payment screen has no way to."
        ),
      ],
      idea: [line("pci-tips-idea", "Offer three tip amounts before the buyer taps")],
      who: [
        line("pci-tips-who", "Food and coffee stalls at weekend markets", { evidence: "fact" }),
      ],
      today: [
        line("pci-tips-today", "A tip jar by the till, for buyers who carry cash", {
          evidence: "fact",
        }),
      ],
      signal: [
        line("pci-tips-signal", "Food stall payments with a tip: from none to 15%", {
          evidence: "assumption",
        }),
      ],
    },
    intake: {
      requesters: ["Market organiser", "Support inbox", "Food stall holder"],
      source: "customer",
      demand: 4,
      status: "assessing",
    },
    ...stamp(-9),
  };

  const ideaSplit: ProductCanvas = {
    id: exampleId("pc-idea-split"),
    format: "idea",
    title: "Split a bill between two cards",
    sections: {
      problem: [
        line(
          "pci-split-problem",
          "Two friends buying one thing want to pay half each, and a stall takes only one card."
        ),
      ],
    },
    intake: {
      requesters: ["Support inbox", "Sales team"],
      source: "customer",
      demand: 2,
      status: "new",
    },
    ...stamp(-8),
  };

  const ideaTwoCards: ProductCanvas = {
    id: exampleId("pc-idea-two-cards"),
    format: "idea",
    title: "Pay with two cards",
    sections: {},
    intake: {
      requesters: ["Sales team"],
      source: "stakeholder",
      demand: 1,
      status: "merged",
      mergedInto: exampleId("pc-idea-split"),
    },
    ...stamp(-10),
  };

  const businessCase: ProductCanvas = {
    id: exampleId("pc-case"),
    format: "business-case",
    title: "Card-machine-free shops",
    sections: {
      epic: [line("pcc-epic", "Every in-person payment on the shop owner's own phone")],
      expect: [
        line(
          "pcc-expect",
          "Shops that rent a card machine today stop renting it within a year, and take more card payments than before, because a buyer can pay anywhere in the shop."
        ),
      ],
      signs: [
        line(
          "pcc-sign-1",
          "Ten pilot shops take half their card payments on the phone by week four"
        ),
      ],
      outcomes: [line("pcc-outcome-1", "Shops with no card machine: from 40% to 70%")],
      "must-be-true": [line("pcc-true-1", "Card schemes keep allowing payments taken on a phone")],
      "in-scope": [line("pcc-in-1", "Tap to pay, refunds and receipts on the phone")],
      "out-of-scope": [line("pcc-out-1", "Online payments and invoices")],
      mvp: [
        line(
          "pcc-mvp",
          "Tap to pay with next-morning payouts, for ten shops in one town, for six weeks."
        ),
      ],
      risks: [
        line(
          "pcc-risk-1",
          "Older phones can't take tap payments: found out by asking the pilot shops which phones they use"
        ),
      ],
    },
    ...stamp(-5),
  };

  // Cycle 4 ran six weeks and ended two days ago: the refund pitch is out of time.
  const cycleWeeks = 6;
  const refundPitch: ProductCanvas = {
    id: exampleId("pc-pitch-refund"),
    format: "shape-up",
    title: "Refund from the phone",
    sections: {
      problem: [
        line(
          "pcs-ref-problem",
          "When a buyer brings something back, the stall holder has to phone us to refund the card payment. On a busy Saturday that means a queue at the stall and a long wait on the line."
        ),
      ],
      solution: [
        line(
          "pcs-ref-solution",
          "A Refund button on each payment in the day's list. It refunds the whole payment, asks once to be sure, and shows the refund in the list."
        ),
      ],
      "rabbit-holes": [line("pcs-ref-hole-1", "Part refunds: we'll refund the whole payment only")],
      "no-gos": [line("pcs-ref-nogo-1", "No refunds of payments older than 30 days")],
      scopes: [
        line("pcs-ref-scope-1", "Refund a whole payment from the day's list"),
        line("pcs-ref-scope-2", "Show refunds in the day's takings"),
        line("pcs-ref-scope-3", "Send the buyer a refund receipt by text", { niceToHave: true }),
      ],
    },
    appetiteWeeks: 2,
    bet: {
      status: "bet",
      cycle: 4,
      start: day(-2 - (cycleWeeks * 7 - 1)),
      weeks: cycleWeeks,
      decidedAt: at(-45),
    },
    ...stamp(-3),
  };

  const receiptsPitch: ProductCanvas = {
    id: exampleId("pc-pitch-receipts"),
    format: "shape-up",
    title: "Receipts by text",
    sections: {
      problem: [
        line(
          "pcs-rec-problem",
          "Buyers ask for a receipt, and a stall has no printer. Some walk away unsure the payment went through."
        ),
      ],
      solution: [
        line(
          "pcs-rec-solution",
          "After a payment, the stall holder can type the buyer's phone number, and the receipt goes by text."
        ),
      ],
      scopes: [
        line("pcs-rec-scope-1", "Send a receipt by text after a payment"),
        line("pcs-rec-scope-2", "Resend a receipt from the day's list", { niceToHave: true }),
      ],
    },
    appetiteWeeks: 6,
    ...stamp(-1),
  };

  return [
    visionBoard,
    valueProposition,
    leanUx,
    prFaq,
    ideaTips,
    ideaSplit,
    ideaTwoCards,
    businessCase,
    refundPitch,
    receiptsPitch,
  ];
}
