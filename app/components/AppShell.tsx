"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WorkingIndicator } from "@/components/Working";
import type { TabDefinition } from "@/lib/tabs";

type AppShellProps = {
  name: string;
  tabs: TabDefinition[];
  children: ReactNode;
};

export function AppShell({ name, tabs, children }: AppShellProps) {
  const pathname = usePathname();
  const publicPreview = pathname === "/showcase";
  const visibleTabs = publicPreview ? tabs.filter((tab) => tab.id !== "contacts") : tabs;

  return (
    <div className="app-shell" data-public-preview={publicPreview ? "true" : "false"}>
      <header className="app-header">
        <Link
          aria-label={`${name} studio assistant`}
          className="assistant-name"
          href={publicPreview ? "/showcase" : (tabs[0]?.href ?? "/")}
        >
          <span className="assistant-mark" aria-hidden="true" />
          <span className="assistant-lockup-copy">
            <strong>{name}</strong>
            <small>Studio assistant</small>
          </span>
        </Link>
        <nav className="tab-nav" aria-label="Primary navigation">
          {visibleTabs.map((tab) => {
            const active =
              pathname === tab.href || pathname.startsWith(`${tab.href}/`) || (publicPreview && tab.id === "talk");
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
        <div className="app-header-status">
          <WorkingIndicator />
          <div
            className="local-status"
            data-preview={publicPreview ? "true" : "false"}
            title="The server runs only on this machine; connected Google services are managed in Settings"
          >
            <span aria-hidden="true" />
            {publicPreview ? "Public preview" : "Private · local-first"}
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
