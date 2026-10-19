import type { Metadata } from "next";
import { MoscowClient } from "./moscow-client";

export const metadata: Metadata = {
  title: "MoSCoW Matrix",
  description:
    "Bucket scope into Must / Should / Could / Won't to align cross-functional teams on what's in vs out.",
};

export default function Page() {
  return <MoscowClient />;
}
