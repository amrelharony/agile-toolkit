import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CFDClient } from "./cfd-client";

export const metadata: Metadata = toolMetadata("cumulative-flow");

export default function CFDPage() {
  return <CFDClient />;
}
