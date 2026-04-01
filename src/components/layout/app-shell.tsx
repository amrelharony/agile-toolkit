"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";
import { EcosystemNav } from "@/components/shared/ecosystem-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <EcosystemNav currentApp="agile" />
      <div className="flex min-h-screen pt-8">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header onOpenSearch={() => setSearchOpen(true)} />
          <main className="flex-1">{children}</main>
        </div>
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </>
  );
}
