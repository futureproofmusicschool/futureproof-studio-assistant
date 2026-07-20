"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { TabDefinition } from "@/lib/tabs";

type AppShellProps = {
  name: string;
  tabs: TabDefinition[];
  children: ReactNode;
};

export function AppShell({ name, tabs, children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="assistant-name" href={tabs[0]?.href ?? "/"}>
          <span className="assistant-mark" aria-hidden="true" />
          {name}
        </Link>
        <nav className="tab-nav" aria-label="Primary navigation">
          {tabs.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                className="tab-link"
                data-active={active ? "true" : "false"}
                href={tab.href}
                key={tab.id}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="local-status" title="This app reads local repository files">
          <span aria-hidden="true" />
          Local
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
