import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { FlowInsightsClient } from "./flow-insights-client";

export const metadata: Metadata = toolMetadata("flow-insights");

export default function Page() {
  return <FlowInsightsClient />;
}
