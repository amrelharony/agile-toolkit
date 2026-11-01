import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RACIClient } from "./raci-client";

export const metadata: Metadata = toolMetadata("raci");

export default function RACIPage() {
  return <RACIClient />;
}
