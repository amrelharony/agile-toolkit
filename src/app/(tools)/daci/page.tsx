import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { DecisionLogClient } from "@/app/(tools)/decision-log/decision-log-client";

/**
 * DACI is the Decision Log raised in the DACI form: the same records,
 * opened with DACI as the default for New. The page keeps its own title so
 * old links and bookmarks land where they did.
 */
export const metadata: Metadata = toolMetadata("daci");

export default function Page() {
  return <DecisionLogClient template="daci" />;
}
