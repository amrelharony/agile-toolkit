import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RiskiestAssumptionClient } from "./riskiest-assumption-client";

export const metadata: Metadata = toolMetadata("riskiest-assumption");

export default function Page() {
  return <RiskiestAssumptionClient />;
}
