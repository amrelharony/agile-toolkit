import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { BurnupClient } from "./burnup-client";

export const metadata: Metadata = toolMetadata("burnup");

export default function BurnupPage() {
  return <BurnupClient />;
}
