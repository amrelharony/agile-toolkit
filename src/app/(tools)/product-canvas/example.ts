/**
 * The example: one canvas per format, all about the payments product of
 * Product Goal's own example, under a made-up name ("Tapline"). It is
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

  return [visionBoard, valueProposition, leanUx, prFaq];
}
