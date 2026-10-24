import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { DoraScorecardClient } from "./dora-scorecard-client";

export const metadata: Metadata = toolMetadata("dora-scorecard");

export default function Page() {
  return <DoraScorecardClient />;
}
