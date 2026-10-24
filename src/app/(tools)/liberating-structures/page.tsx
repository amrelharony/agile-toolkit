import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { LiberatingStructuresClient } from "./liberating-structures-client";

export const metadata: Metadata = toolMetadata("liberating-structures");

export default function Page() {
  return <LiberatingStructuresClient />;
}
