import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { HypothesisTrackerClient } from "./hypothesis-tracker-client";

export const metadata: Metadata = toolMetadata("hypothesis-tracker");

export default function Page() {
  return <HypothesisTrackerClient />;
}
