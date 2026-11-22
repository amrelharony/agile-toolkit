import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { EbmDashboardClient } from "./ebm-dashboard-client";

export const metadata: Metadata = toolMetadata("ebm-dashboard");

export default function Page() {
  return <EbmDashboardClient />;
}
