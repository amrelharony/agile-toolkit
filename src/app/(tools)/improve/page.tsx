import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ImproveClient } from "./improve-client";

export const metadata: Metadata = toolMetadata("improve");

export default function Page() {
  return <ImproveClient />;
}
