import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { StakeholderMapClient } from "./stakeholder-map-client";

export const metadata: Metadata = toolMetadata("stakeholder-map");

export default function Page() {
  return <StakeholderMapClient />;
}
