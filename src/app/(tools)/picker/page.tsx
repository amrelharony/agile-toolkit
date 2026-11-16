import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PickerClient } from "./picker-client";

export const metadata: Metadata = toolMetadata("picker");

export default function Page() {
  return <PickerClient />;
}
