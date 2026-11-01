import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { AdkarClient } from "./adkar-client";

export const metadata: Metadata = toolMetadata("adkar");

export default function Page() {
  return <AdkarClient />;
}
