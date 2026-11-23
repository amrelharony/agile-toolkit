import type { Metadata } from "next";
import { EstimateView } from "../async/estimate-view";

/**
 * /planning-poker/estimate#estimate=…: where people estimate a round
 * without a meeting. Its own route, so it never loads the Poker page; the
 * round is in the link's fragment, which browsers never send to the server.
 * Each link is one team's round, so it stays out of search results.
 */
export const metadata: Metadata = {
  title: "Estimate without a meeting",
  description:
    "Pick a card for each story and send your reply to the facilitator. Nothing you pick leaves the page until you copy your reply.",
  robots: { index: false, follow: false },
};

export default function PlanningPokerEstimatePage() {
  return <EstimateView />;
}
