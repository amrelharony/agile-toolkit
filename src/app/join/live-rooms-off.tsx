import Link from "next/link";
import { Radio } from "lucide-react";

/** `/join` and `/join/<tool>/<code>` while `NEXT_PUBLIC_VISITOR_ROOMS` is off. */
export function LiveRoomsOff() {
  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 flex flex-col gap-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-text">
          <Radio className="h-5 w-5 text-sub" aria-hidden="true" />
          Live rooms are off
        </h1>
        <p className="text-sm text-sub">
          This site isn&apos;t running live rooms at the moment, so this link can&apos;t connect.
          You can still run the tools on one shared screen, or ask the host to count hands.
        </p>
        <Link
          href="/"
          className="self-start rounded-md border border-border px-3 py-2 text-sm text-text hover:border-accent/40 hover:text-accent"
        >
          Go to the Agile Toolkit
        </Link>
      </section>
    </main>
  );
}
