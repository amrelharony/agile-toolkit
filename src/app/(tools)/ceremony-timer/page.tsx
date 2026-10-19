import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CeremonyTimerClient } from "./ceremony-timer-client";

export const metadata: Metadata = toolMetadata("ceremony-timer");

export default function CeremonyTimerPage() {
  return <CeremonyTimerClient />;
}
