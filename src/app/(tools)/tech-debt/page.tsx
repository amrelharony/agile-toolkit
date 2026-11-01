import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { TechDebtClient } from "./tech-debt-client";

export const metadata: Metadata = toolMetadata("tech-debt");

export default function Page() {
  return <TechDebtClient />;
}
