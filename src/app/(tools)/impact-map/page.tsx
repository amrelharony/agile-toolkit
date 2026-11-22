import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ImpactMapClient } from "./impact-map-client";

export const metadata: Metadata = toolMetadata("impact-map");

export default function Page() {
  return <ImpactMapClient />;
}
