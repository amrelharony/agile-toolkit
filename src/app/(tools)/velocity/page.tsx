import type { Metadata } from "next";
import { VelocityClient } from "./velocity-client";

export const metadata: Metadata = { title: "Velocity Tracker" };

export default function VelocityPage() {
  return <VelocityClient />;
}
