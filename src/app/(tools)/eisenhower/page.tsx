import type { Metadata } from "next";
import { EisenhowerClient } from "./eisenhower-client";

export const metadata: Metadata = {
  title: "Eisenhower Matrix",
  description:
    "Answer whether each task is urgent and important, add a due date, and see it sorted into Do, Schedule, Delegate or Delete.",
};

export default function Page() {
  return <EisenhowerClient />;
}
