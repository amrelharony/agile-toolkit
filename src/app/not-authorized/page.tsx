import { SignOutButton } from "./sign-out-button";

export const metadata = {
  title: "Not authorized — Agile Toolkit",
  description: "This account is not allowed to use this workspace.",
};

export default function NotAuthorizedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 text-destructive text-2xl">
          ⊘
        </div>
        <h1 className="text-2xl font-semibold text-text">Not authorized</h1>
        <p className="text-sub leading-relaxed">
          This Agile Toolkit workspace is restricted to a single account. The
          Google account you signed in with isn&apos;t on the allowlist.
        </p>
        <p className="text-xs text-sub">
          If this is your workspace, check that <code className="font-mono">AUTHORIZED_EMAILS</code>{" "}
          is set correctly in the deployment environment.
        </p>
        <div className="pt-2">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
