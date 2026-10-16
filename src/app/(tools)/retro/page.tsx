import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RetroClient } from "./retro-client";

export const metadata: Metadata = toolMetadata("retro");

export default function RetroPage() {
  return <RetroClient />;
}
