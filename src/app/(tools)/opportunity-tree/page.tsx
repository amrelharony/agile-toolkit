import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { OpportunityTreeClient } from "./opportunity-tree-client";

export const metadata: Metadata = toolMetadata("opportunity-tree");

export default function Page() {
  return <OpportunityTreeClient />;
}
