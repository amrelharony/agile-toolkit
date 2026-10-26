import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PsychSafetyClient } from "./psych-safety-client";

export const metadata: Metadata = toolMetadata("psych-safety");

export default function Page() {
  return <PsychSafetyClient />;
}
