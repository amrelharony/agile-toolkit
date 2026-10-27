import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { TestPyramidClient } from "./test-pyramid-client";

export const metadata: Metadata = toolMetadata("test-pyramid");

export default function Page() {
  return <TestPyramidClient />;
}
