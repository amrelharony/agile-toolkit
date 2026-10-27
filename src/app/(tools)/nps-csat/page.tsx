import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { NpsCsatClient } from "./nps-csat-client";

export const metadata: Metadata = toolMetadata("nps-csat");

export default function Page() {
  return <NpsCsatClient />;
}
