import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { IceBreakerClient } from "./icebreaker-client";

export const metadata: Metadata = toolMetadata("icebreaker");

export default function IceBreakerPage() {
  return <IceBreakerClient />;
}
