import type { Metadata } from "next";
import { CostOfDelayClient } from "./cost-of-delay-client";

export const metadata: Metadata = {
  title: "Cost-of-Delay Tracker",
  description:
    "Quantify per-week revenue/value loss of delaying each initiative; pairs with WSJF and queue management.",
};

export default function Page() {
  return <CostOfDelayClient />;
}
