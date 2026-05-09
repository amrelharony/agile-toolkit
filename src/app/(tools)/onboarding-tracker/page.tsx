import { OnboardingTrackerClient } from "./onboarding-tracker-client";

export const metadata = {
  title: "Onboarding Speed Tracker — Agile Toolkit",
  description:
    "Time-to-first-PR and time-to-productivity per onboardee with a ramp curve.",
};

export default function Page() {
  return <OnboardingTrackerClient />;
}
