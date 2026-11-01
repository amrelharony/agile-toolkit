import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { MoscowClient } from "./moscow-client";

export const metadata: Metadata = toolMetadata("moscow");

export default function Page() {
  return <MoscowClient />;
}
