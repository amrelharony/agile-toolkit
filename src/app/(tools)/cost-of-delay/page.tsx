import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CostOfDelayClient } from "./cost-of-delay-client";

// The catalog's description still reads as the old per-week total; this
// page scores CD3, so it says so until lib/constants/tools.ts catches up.
export const metadata: Metadata = toolMetadata("cost-of-delay", {
  description:
    "Score initiatives by CD3, cost of delay per week ÷ duration, in urgency lanes: expedite, fixed date, standard and intangible; pairs with WSJF.",
});

export default function Page() {
  return <CostOfDelayClient />;
}
