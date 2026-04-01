import type { Metadata } from "next";
import { IceBreakerClient } from "./icebreaker-client";

export const metadata: Metadata = { title: "Ice Breaker Generator" };

export default function IceBreakerPage() {
  return <IceBreakerClient />;
}
