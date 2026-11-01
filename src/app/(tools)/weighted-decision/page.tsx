import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { WeightedDecisionClient } from "./weighted-decision-client";

export const metadata: Metadata = toolMetadata("weighted-decision");

export default function Page() {
  return <WeightedDecisionClient />;
}
