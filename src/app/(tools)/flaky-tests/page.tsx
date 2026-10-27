import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { FlakyTestsClient } from "./flaky-tests-client";

export const metadata: Metadata = toolMetadata("flaky-tests");

export default function Page() {
  return <FlakyTestsClient />;
}
