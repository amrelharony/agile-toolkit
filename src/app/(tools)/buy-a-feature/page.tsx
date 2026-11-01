import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { BuyAFeatureClient } from "./buy-a-feature-client";

export const metadata: Metadata = toolMetadata("buy-a-feature");

export default function Page() {
  return <BuyAFeatureClient />;
}
