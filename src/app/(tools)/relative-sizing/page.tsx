import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RelativeSizingClient } from "./relative-sizing-client";

export const metadata: Metadata = toolMetadata("relative-sizing");

export default function Page() {
  return <RelativeSizingClient />;
}
