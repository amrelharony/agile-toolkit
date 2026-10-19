import type { Metadata } from "next";
import { ModelComparisonClient } from "./model-comparison-client";

export const metadata: Metadata = {
  title: "Model Comparison Matrix",
  description:
    "Per-model cost / 1k tokens, latency, context window, eval score, vendor lock-in, and status.",
};

export default function Page() {
  return <ModelComparisonClient />;
}
