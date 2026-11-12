import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ParkingLotClient } from "./parking-lot-client";

export const metadata: Metadata = toolMetadata("parking-lot");

export default function Page() {
  return <ParkingLotClient />;
}
