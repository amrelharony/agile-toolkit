import type { Metadata } from "next";
import { AISafetyChecklistClient } from "./ai-safety-checklist-client";

export const metadata: Metadata = {
  title: "AI Safety Review Checklist — Agile Toolkit",
  description:
    "Pre-launch checklist: data privacy, jailbreak tests, content-policy mapping, NIST RMF alignment.",
};

export default function Page() {
  return <AISafetyChecklistClient />;
}
