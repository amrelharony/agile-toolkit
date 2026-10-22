import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RetroActionsClient } from "./retro-actions-client";

export const metadata: Metadata = toolMetadata("retro-actions");

export default function RetroActionsPage() {
  return <RetroActionsClient />;
}
