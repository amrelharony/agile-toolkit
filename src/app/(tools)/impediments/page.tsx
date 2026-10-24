import type { Metadata } from "next";
import { ImpedimentsClient } from "./impediments-client";

export const metadata: Metadata = {
  title: "Impediment Tracker",
  description:
    "Log, escalate and resolve impediments with owners, due dates, age badges and time-to-resolve metrics.",
};

export default function ImpedimentsPage() {
  return <ImpedimentsClient />;
}
