import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { EstimationGuideClient } from "./estimation-guide-client";

export const metadata: Metadata = toolMetadata("estimation-guide");

export default function EstimationGuidePage() {
  return <EstimationGuideClient />;
}
