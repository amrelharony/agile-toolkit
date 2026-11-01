import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { DoraScorecardClient } from "./dora-scorecard-client";

// The catalogue's line still calls it a manual-input dashboard; until it
// changes, the page says what it is now.
export const metadata: Metadata = toolMetadata("dora-scorecard", {
  description:
    "The four DORA metrics quarter by quarter, typed or filled from your releases, boards and incidents, banded by the 2023 Accelerate State of DevOps Report.",
});

export default function Page() {
  return <DoraScorecardClient />;
}
