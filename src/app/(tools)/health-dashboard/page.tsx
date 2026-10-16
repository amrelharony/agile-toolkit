import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { HealthDashboardClient } from "./health-dashboard-client";

export const metadata: Metadata = toolMetadata("health-dashboard");

export default function HealthDashboardPage() {
  return <HealthDashboardClient />;
}
