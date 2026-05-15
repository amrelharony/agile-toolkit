import type { Metadata } from "next";
import { RapidDecisionClient } from "./rapid-decision-client";

export const metadata: Metadata = {
  title: "RAPID Decision Matrix — Agile Toolkit",
  description:
    "Bain's Recommend / Agree / Perform / Input / Decide model for governance-heavy decisions.",
};

export default function Page() {
  return <RapidDecisionClient />;
}
