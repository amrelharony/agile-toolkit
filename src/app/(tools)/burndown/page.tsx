import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { BurndownClient } from "./burndown-client";

export const metadata: Metadata = toolMetadata("burndown");

export default function BurndownPage() {
  return <BurndownClient />;
}
