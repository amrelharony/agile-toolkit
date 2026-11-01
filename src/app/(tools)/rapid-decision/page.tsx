import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { DecisionLogClient } from "@/app/(tools)/decision-log/decision-log-client";

/**
 * RAPID is the Decision Log raised in the RAPID form: the same records,
 * opened with RAPID as the default for New. The page keeps its own title so
 * old links and bookmarks land where they did.
 */
export const metadata: Metadata = toolMetadata("rapid-decision");

export default function Page() {
  return <DecisionLogClient template="rapid" />;
}
