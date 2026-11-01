import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CostOfDelayClient } from "./cost-of-delay-client";

export const metadata: Metadata = toolMetadata("cost-of-delay");

export default function Page() {
  return <CostOfDelayClient />;
}
