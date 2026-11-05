"use client";

import { ReactNode } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { Footer } from "@/components/Footer";
import { useSidebar } from "@/components/SidebarContext";

type Props = {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function WorkspaceShell({ title, subtitle, actions, children }: Props) {
  const { collapsed } = useSidebar();

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <AppTopbar />

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-core-on-background">{title}</h1>
              <p className="mt-1 text-sm text-core-on-surface-variant">{subtitle}</p>
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>

          <div className="space-y-4">{children}</div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
