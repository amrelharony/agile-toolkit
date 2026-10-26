import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PrioritizerClient } from "./prioritizer-client";

export const metadata: Metadata = toolMetadata("prioritizer");

export default function PrioritizerPage() {
  return <PrioritizerClient />;
}
