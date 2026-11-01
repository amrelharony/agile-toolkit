import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { WorkingAgreementClient } from "./working-agreement-client";

export const metadata: Metadata = toolMetadata("working-agreement");

export default function Page() {
  return <WorkingAgreementClient />;
}
