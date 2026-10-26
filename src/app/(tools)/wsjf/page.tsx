import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { WsjfClient } from "./wsjf-client";

export const metadata: Metadata = toolMetadata("wsjf");

export default function Page() {
  return <WsjfClient />;
}
