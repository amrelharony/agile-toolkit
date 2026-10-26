import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { DodBuilderClient } from "./dod-builder-client";

export const metadata: Metadata = toolMetadata("dod-builder");

export default function Page() {
  return <DodBuilderClient />;
}
