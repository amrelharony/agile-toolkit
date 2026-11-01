import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { HundredDollarTestClient } from "./hundred-dollar-test-client";

export const metadata: Metadata = toolMetadata("hundred-dollar-test");

export default function Page() {
  return <HundredDollarTestClient />;
}
