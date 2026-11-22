import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { StrategyTreeClient } from "./strategy-tree-client";

export const metadata: Metadata = toolMetadata("strategy-tree");

export default function Page() {
  return <StrategyTreeClient />;
}
