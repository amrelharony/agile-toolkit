import type { Metadata } from "next";
import { LLMEvalTrackerClient } from "./llm-eval-tracker-client";

export const metadata: Metadata = {
  title: "LLM Eval Tracker — Agile Toolkit",
  description:
    "Time-series of LLM eval scores across releases — accuracy, faithfulness, relevance — per prompt and dataset, with regression detection.",
};

export default function Page() {
  return <LLMEvalTrackerClient />;
}
