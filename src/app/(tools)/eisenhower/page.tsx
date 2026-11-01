import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { EisenhowerClient } from "./eisenhower-client";

export const metadata: Metadata = toolMetadata("eisenhower");

export default function Page() {
  return <EisenhowerClient />;
}
