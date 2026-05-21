import type { Metadata } from "next";
import { HallucinationLogClient } from "./hallucination-log-client";

export const metadata: Metadata = {
  title: "Hallucination Log — Agile Toolkit",
  description:
    "Incident register for AI quality issues: input, expected, actual, severity, root-cause, fix applied.",
};

export default function Page() {
  return <HallucinationLogClient />;
}
