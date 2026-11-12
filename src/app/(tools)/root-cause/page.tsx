import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RootCauseClient } from "./root-cause-client";

export const metadata: Metadata = toolMetadata("root-cause");

export default function Page() {
  return <RootCauseClient />;
}
