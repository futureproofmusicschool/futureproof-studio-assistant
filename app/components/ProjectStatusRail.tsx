"use client";
import { clientFetch } from "@/lib/client-requests";

import Link from "next/link";
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from "react";

import type { MeterStore } from "@/lib/meter-store";

type ProjectStatusRailProps = {
  inCall: boolean;
  lastFiledDay: string | null;
  meter: MeterStore;
  publicPreview: boolean;
};

type ConnectorStatus = {
  apps?: { drive?: { connected?: boolean } };
};

type AbletonHealth = {
  reachable?: boolean;
};

function filedLabel(day: string | null) {
  if (!day) return "Daily";
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Daily";
  return `Filed ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed)}`;
}

export function ProjectStatusRail({ inCall, lastFiledDay, meter, publicPreview }: ProjectStatusRailProps) {
  const [abletonConnected, setAbletonConnected] = useState<boolean | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (publicPreview) return;
    let active = true;

    const inspectAbleton = async () => {
      try {
        const response = await clientFetch("/api/ableton/health", { cache: "no-store" });
        const body = (await response.json()) as AbletonHealth;
        if (active) setAbletonConnected(response.ok && body.reachable === true);
      } catch {
        if (active) setAbletonConnected(false);
      }
    };

    const inspectDrive = async () => {
      try {
        const response = await clientFetch("/api/connectors/status", { cache: "no-store" });
        const body = (await response.json()) as ConnectorStatus;
        if (active) setDriveConnected(response.ok && body.apps?.drive?.connected === true);
      } catch {
        if (active) setDriveConnected(false);
      }
    };

    void inspectAbleton();
    void inspectDrive();
    const abletonTimer = window.setInterval(() => void inspectAbleton(), 8_000);

    return () => {
      active = false;
      window.clearInterval(abletonTimer);
    };
  }, [publicPreview]);

  const statuses = publicPreview
    ? [
        { label: "Conversation", value: "Shipped", tone: "active" },
        { label: "Memory", value: "Shipped", tone: "active" },
        { label: "Ableton", value: "Shipped", tone: "active" },
        { label: "Native docs", value: "Shipped", tone: "active" },
      ]
    : [
        { label: "Conversation", value: inCall ? "Listening" : "Ready", tone: "active" },
        { label: "Memory", value: filedLabel(lastFiledDay), tone: "steady" },
        {
          label: "Ableton",
          value: abletonConnected === null ? "Checking" : abletonConnected ? "Connected" : "Offline",
          tone: abletonConnected ? "active" : "muted",
        },
        {
          label: "Native docs",
          value: driveConnected === null ? "Checking" : driveConnected ? "Linked" : "Setup",
          tone: driveConnected ? "active" : "muted",
        },
      ];


  return (
    <aside className="project-status-rail" aria-label="Project status">
      <ProjectSignal inCall={inCall} meter={meter} />

      <section className="project-status-section">
        <div className="project-status-heading">
          <p className="eyebrow">{publicPreview ? "Project status" : "System status"}</p>
          <span>Build 0.1.0</span>
        </div>
        <dl className="project-status-list">
          {statuses.map((status) => (
            <div key={status.label}>
              <dt>{status.label}</dt>
              <dd data-tone={status.tone}>
                <span aria-hidden="true" />
                {status.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="project-focus">
        <p className="eyebrow">Current focus</p>
        <h2>Finish one continuous studio workflow.</h2>
        <p>Conversation, tools, memory, and the work itself—all in the same creative thread.</p>
      </section>

      <Link className="showcase-link" href={publicPreview ? "/talk" : "/showcase"}>
        {publicPreview ? "Return to private workspace" : "Open safe public preview"}
        <span aria-hidden="true">↗</span>
      </Link>
    </aside>
  );
}

function ProjectSignal({ inCall, meter }: { inCall: boolean; meter: MeterStore }) {
  const micLevel = useSyncExternalStore(meter.subscribe, meter.getSnapshot, meter.getServerSnapshot);
  const signalStyle = { "--signal-level": Math.max(0.12, micLevel).toFixed(2) } as CSSProperties;
  return (
      <div className="project-signal" data-live={inCall ? "true" : "false"} style={signalStyle} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
  );
}
