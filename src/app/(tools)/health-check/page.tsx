import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { HealthCheckClient } from "./health-check-client";

export const metadata: Metadata = toolMetadata("health-check");

export default function HealthCheckPage() {
  return <HealthCheckClient />;
}
