import { HypothesisTrackerClient } from "./hypothesis-tracker-client";

export const metadata = {
  title: "Hypothesis Tracker — Agile Toolkit",
  description: "Track lean-startup hypotheses with experiments, metrics, and validation rate.",
};

export default function Page() {
  return <HypothesisTrackerClient />;
}
