import type { Metadata } from "next";
import { AIRedTeamClient } from "./ai-red-team-client";

export const metadata: Metadata = {
  title: "AI Red-Team Session Log",
  description:
    "Adversarial-prompt session record: attack vector, success rate, mitigation, retest date.",
};

export default function Page() {
  return <AIRedTeamClient />;
}
