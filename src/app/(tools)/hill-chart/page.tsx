import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { HillChartClient } from "./hill-chart-client";

export const metadata: Metadata = toolMetadata("hill-chart");

export default function Page() {
  return <HillChartClient />;
}
