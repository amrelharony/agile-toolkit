import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { FacilitatorTimersClient } from "./facilitator-timers-client";

export const metadata: Metadata = toolMetadata("facilitator-timers");

export default function Page() {
  return <FacilitatorTimersClient />;
}
