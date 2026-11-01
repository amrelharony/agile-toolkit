import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CodeReviewMetricsClient } from "./code-review-metrics-client";

export const metadata: Metadata = toolMetadata("code-review-metrics");

export default function Page() {
  return <CodeReviewMetricsClient />;
}
