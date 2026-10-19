import { ValueStreamClient } from "./value-stream-client";

export const metadata = {
  title: "Value Stream Map",
  description: "Visualize lead time, process time, and flow efficiency across your value stream.",
};

export default function Page() {
  return <ValueStreamClient />;
}
