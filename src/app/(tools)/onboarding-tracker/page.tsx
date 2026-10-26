import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { OnboardingTrackerClient } from "./onboarding-tracker-client";

export const metadata: Metadata = toolMetadata("onboarding-tracker");

export default function Page() {
  return <OnboardingTrackerClient />;
}
