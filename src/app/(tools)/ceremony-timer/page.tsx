import type { Metadata } from "next";
import { CeremonyTimerClient } from "./ceremony-timer-client";

export const metadata: Metadata = { title: "Ceremony Timer" };

export default function CeremonyTimerPage() {
  return <CeremonyTimerClient />;
}
