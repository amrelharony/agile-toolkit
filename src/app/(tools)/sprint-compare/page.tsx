import type { Metadata } from "next";
import { SprintCompareClient } from "./sprint-compare-client";

export const metadata: Metadata = { title: "Sprint Comparison" };

export default function SprintComparePage() {
  return <SprintCompareClient />;
}
