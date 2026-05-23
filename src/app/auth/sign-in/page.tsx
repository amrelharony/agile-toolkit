import { Suspense } from "react";
import { SignInCard } from "./sign-in-card";

export const metadata = {
  title: "Sign in — Agile Toolkit",
  description: "Sign in to your Agile Toolkit workspace.",
};

export default function SignInPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-10">
      {/* Brand: logo + title above the card. text-text gets the theme's
          primary foreground; the AT.svg is dark-mode optimised but still
          legible against the light/HC themes thanks to its rounded white-
          background variant. */}
      <header className="flex flex-col items-center gap-4">
        {/* Plain <img> rather than next/image: the optimizer 400s on SVG
            unless you opt into dangerouslyAllowSVG globally. Logos are
            tiny static assets — no optimization upside, and bypassing
            the optimizer keeps the deploy footprint smaller. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/AT.svg"
          alt="Agile Toolkit"
          width={72}
          height={72}
          className="rounded-2xl shadow-sm"
        />
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-text">
            Agile Toolkit
          </h1>
          <p className="text-sm text-sub">
            100+ tools for agile delivery, in one workspace.
          </p>
        </div>
      </header>

      <Suspense fallback={null}>
        <SignInCard />
      </Suspense>

      <footer className="text-xs text-sub">
        built by{" "}
        <a
          href="https://amrelharony.com"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-4 hover:text-accent transition-colors"
        >
          Amr Elharony
        </a>
      </footer>
    </main>
  );
}
