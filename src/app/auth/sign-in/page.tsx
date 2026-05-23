import { Suspense } from "react";
import { SignInCard } from "./sign-in-card";

export const metadata = {
  title: "Sign in — Agile Toolkit",
  description: "Sign in to your Agile Toolkit workspace.",
};

export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <Suspense fallback={null}>
        <SignInCard />
      </Suspense>
    </main>
  );
}
