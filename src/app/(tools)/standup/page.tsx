import type { Metadata } from "next";
import { StandupClient } from "./standup-client";

export const metadata: Metadata = { title: "Standup Tracker" };

export default function StandupPage() {
  return <StandupClient />;
}
