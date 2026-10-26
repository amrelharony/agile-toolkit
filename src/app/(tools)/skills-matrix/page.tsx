import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SkillsMatrixClient } from "./skills-matrix-client";

export const metadata: Metadata = toolMetadata("skills-matrix");

export default function SkillsMatrixPage() {
  return <SkillsMatrixClient />;
}
