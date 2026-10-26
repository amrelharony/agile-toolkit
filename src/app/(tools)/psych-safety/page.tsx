import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PsychSafetyClient } from "./psych-safety-client";

// The catalog's description still names the uncited benchmark the tool dropped.
export const metadata: Metadata = toolMetadata("psych-safety", {
  description:
    "Edmondson's seven-statement survey in anonymous rounds, with a team score from five responses and a round-by-round comparison.",
});

export default function Page() {
  return <PsychSafetyClient />;
}
