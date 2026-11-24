import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ProductMetricsClient } from "./product-metrics-client";

export const metadata: Metadata = toolMetadata("product-metrics");

export default function Page() {
  return <ProductMetricsClient />;
}
