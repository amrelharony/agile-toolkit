import { PsychSafetyClient } from "./psych-safety-client";

export const metadata = {
  title: "Psychological Safety Assessment — Agile Toolkit",
  description:
    "Edmondson 7-question survey with team-vs-org benchmark and per-question radar.",
};

export default function Page() {
  return <PsychSafetyClient />;
}
