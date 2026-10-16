import type { Metadata } from "next";
import { AIFeatureSpecClient } from "./ai-feature-spec-client";

export const metadata: Metadata = {
  title: "AI Feature Spec",
  description:
    "PRD variant for AI features: model choice, eval criteria, fallback path, latency budget, hallucination tolerance.",
};

export default function Page() {
  return <AIFeatureSpecClient />;
}
