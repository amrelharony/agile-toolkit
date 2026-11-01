import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { QualityCostClient } from "./quality-cost-client";

export const metadata: Metadata = toolMetadata("quality-cost");

export default function Page() {
  return <QualityCostClient />;
}
