import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { KanoModelClient } from "./kano-model-client";

export const metadata: Metadata = toolMetadata("kano-model");

export default function Page() {
  return <KanoModelClient />;
}
