import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { VelocityClient } from "./velocity-client";

export const metadata: Metadata = toolMetadata("velocity");

export default function VelocityPage() {
  return <VelocityClient />;
}
