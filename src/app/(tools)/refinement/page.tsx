import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RefinementClient } from "./refinement-client";

export const metadata: Metadata = toolMetadata("refinement");

export default function RefinementPage() {
  return <RefinementClient />;
}
