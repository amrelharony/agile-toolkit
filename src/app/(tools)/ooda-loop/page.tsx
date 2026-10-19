import type { Metadata } from "next";
import { OodaLoopClient } from "./ooda-loop-client";

export const metadata: Metadata = {
  title: "OODA Loop Tracker",
  description:
    "Boyd's Observe-Orient-Decide-Act cycle for fast adaptation in chaotic or adversarial conditions.",
};

export default function Page() {
  return <OodaLoopClient />;
}
