import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { OkrsClient } from "./okrs-client";

export const metadata: Metadata = toolMetadata("okrs");

export default function Page() {
  return <OkrsClient />;
}
