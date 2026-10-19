import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SprintCompareClient } from "./sprint-compare-client";

export const metadata: Metadata = toolMetadata("sprint-compare");

export default function SprintComparePage() {
  return <SprintCompareClient />;
}
