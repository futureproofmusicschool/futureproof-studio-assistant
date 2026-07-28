"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Health = { host: string; reachable: boolean; version?: string };
type InstallState = { supported: boolean; installed: boolean; message?: string; error?: string };

type DiscoveredHost = {
  host: string;
  name: string;
  current: boolean;
  reachable: boolean;
  version?: string;
};

async function fetchHealth(): Promise<Health | null> {
  try {
    const response = await fetch("/api/ableton/health", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}

/** Small live-session chip: green when Live answers on the chosen machine. */
export function AbletonChip() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next = await fetchHealth();
      if (active) setHealth(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const label = health?.reachable
    ? `Ableton connected${health.host === "127.0.0.1" ? "" : ` (${health.host.replace(/\.local$/i, "")})`}`
    : "Ableton offline";

  return (
    <span className="ableton-chip" data-ok={health?.reachable ? "true" : "false"} title={label}>
      <span aria-hidden="true" />
      Ableton
    </span>
  );
}

/** Machine picker shown on the Talk setup screen. */
export function AbletonPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [installState, setInstallState] = useState<InstallState | null>(null);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hosts, setHosts] = useState<DiscoveredHost[] | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetchHealth().then((next) => {
      if (mountedRef.current) setHealth(next);
    });
    void fetch("/api/ableton/install", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: InstallState) => {
        if (mountedRef.current) setInstallState(body);
      })
      .catch(() => {
        if (mountedRef.current) setInstallState(null);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const response = await fetch("/api/ableton/discover", { cache: "no-store" });
      const body = (await response.json()) as { hosts?: DiscoveredHost[]; error?: string };
      if (!response.ok || !body.hosts) throw new Error(body.error || "Discovery failed.");
      if (mountedRef.current) setHosts(body.hosts);
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }, []);

  const choose = useCallback(async (host: string) => {
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abletonHost: host }),
      });
      const body = (await response.json()) as { abletonHost?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the setting.");
      const next = await fetchHealth();
      if (mountedRef.current) {
        setHealth(next);
        setHosts((current) =>
          current ? current.map((entry) => ({ ...entry, current: entry.host === host })) : current,
        );
      }
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Could not save the setting.");
    }
  }, []);

  const openPanel = () => {
    setOpen(true);
    if (!hosts && !scanning) void scan();
  };

  const install = useCallback(async () => {
    setInstalling(true);
    setInstallError(null);
    setInstallMessage(null);
    try {
      const response = await fetch("/api/ableton/install", {
        method: "POST",
        headers: { "x-studio-assistant-action": "install-abletonosc" },
      });
      const body = (await response.json()) as InstallState;
      if (!response.ok) throw new Error(body.error || "AbletonOSC installation failed.");
      if (mountedRef.current) {
        setInstallState(body);
        setConfirmInstall(false);
        setInstallMessage(
          "Installed. Restart Ableton Live, then select AbletonOSC under Preferences → Link, Tempo & MIDI.",
        );
      }
    } catch (caught) {
      if (mountedRef.current) {
        setInstallError(caught instanceof Error ? caught.message : "AbletonOSC installation failed.");
      }
    } finally {
      if (mountedRef.current) setInstalling(false);
    }
  }, []);

  const currentLabel = health
    ? health.host === "127.0.0.1"
      ? "this Mac"
      : health.host.replace(/\.local$/i, "")
    : "...";

  return (
    <div className="ableton-panel">
      <div className="ableton-panel-summary">
        <span className="ableton-chip" data-ok={health?.reachable ? "true" : "false"}>
          <span aria-hidden="true" />
          {health?.reachable ? `Ableton Live on ${currentLabel}` : `Ableton not reachable on ${currentLabel}`}
        </span>
        <button onClick={() => (open ? setOpen(false) : openPanel())} type="button">
          {open ? "Close" : "Change machine"}
        </button>
      </div>

      {open ? (
        <div className="ableton-panel-body">
          {error ? <p className="ableton-panel-error">{error}</p> : null}
          {scanning ? <p className="ableton-panel-hint">Scanning the network...</p> : null}
          {hosts ? (
            <ul>
              {hosts.map((entry) => (
                <li key={entry.host}>
                  <button
                    data-current={entry.current ? "true" : "false"}
                    onClick={() => void choose(entry.host)}
                    type="button"
                  >
                    <span className="ableton-host-dot" data-ok={entry.reachable ? "true" : "false"} aria-hidden="true" />
                    <span className="ableton-host-name">{entry.name}</span>
                    <span className="ableton-host-state">
                      {entry.reachable ? `Live ${entry.version ?? ""}`.trim() : "no Live answering"}
                      {entry.current ? " · selected" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="ableton-panel-manual">
            <input
              onChange={(event) => setManual(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && manual.trim()) {
                  event.preventDefault();
                  void choose(manual.trim());
                }
              }}
              placeholder="Or type a hostname, e.g. Studio-Mac.local"
              value={manual}
            />
            <button disabled={!manual.trim()} onClick={() => void choose(manual.trim())} type="button">
              Use
            </button>
            <button disabled={scanning} onClick={() => void scan()} type="button">
              Rescan
            </button>
          </div>
          <p className="ableton-panel-hint">
            The selected machine must be running Live with the AbletonOSC control surface enabled.
          </p>
        </div>
      ) : null}

      {installState?.supported ? (
        <div className="ableton-installer">
          <div className="ableton-installer-summary">
            <div>
              <strong>{installState.installed ? "AbletonOSC is installed on this Mac" : "Install AbletonOSC"}</strong>
              <p>
                {health?.host && health.host !== "127.0.0.1"
                  ? "This action affects the Mac running Studio Assistant, not the remote Ableton machine selected above."
                  : "Copies the bundled control surface into this Mac’s Ableton User Library."}
              </p>
            </div>
            {!confirmInstall ? (
              <button disabled={installing} onClick={() => setConfirmInstall(true)} type="button">
                {installState.installed ? "Reinstall" : "Install on this Mac"}
              </button>
            ) : null}
          </div>

          <div className="ableton-installer-confirm" data-open={confirmInstall ? "true" : "false"}>
            <div>
              <p>
                {installState.installed
                  ? "This replaces the existing AbletonOSC folder with the bundled version."
                  : "This writes AbletonOSC to Ableton’s Remote Scripts folder."}
              </p>
              <div>
                <button className="ableton-install-confirm" disabled={installing} onClick={() => void install()} type="button">
                  {installing ? "Installing…" : "Confirm install"}
                </button>
                <button disabled={installing} onClick={() => setConfirmInstall(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          </div>

          {installMessage ? (
            <p className="ableton-installer-result" role="status">
              {installMessage}
            </p>
          ) : null}
          {installError ? (
            <p className="ableton-panel-error" role="alert">
              {installError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
