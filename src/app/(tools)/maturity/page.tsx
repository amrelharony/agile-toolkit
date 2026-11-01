import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { MaturityClient } from "./maturity-client";

export const metadata: Metadata = toolMetadata("maturity");

export default function MaturityPage() {
  return <MaturityClient />;
}
