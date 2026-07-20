import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { readAssistantConfig } from "@/lib/config";
import { enabledTabs } from "@/lib/tabs";
import "./globals.css";

export function generateMetadata(): Metadata {
  const config = readAssistantConfig();
  return {
    title: config.name,
    description: `${config.name} local workspace`,
  };
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const config = readAssistantConfig();
  const style = { "--accent": config.accentColor } as CSSProperties;

  return (
    <html lang="en" style={style}>
      <body>
        <AppShell name={config.name} tabs={enabledTabs(config.tabs)}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
