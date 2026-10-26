import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RiceScoringClient } from "./rice-scoring-client";

export const metadata: Metadata = toolMetadata("rice-scoring");

export default function Page() {
  return <RiceScoringClient />;
}
