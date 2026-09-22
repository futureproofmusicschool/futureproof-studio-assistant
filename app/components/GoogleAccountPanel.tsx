"use client";
import { clientFetch } from "@/lib/client-requests";

import { useCallback, useEffect, useRef, useState } from "react";

type ConnectorHost = "auto" | "codex" | "claude" | "direct-google";
type EffectiveHost = Exclude<ConnectorHost, "auto"> | null;
type ConnectorState =
  | "ready"
  | "needs_host"
  | "needs_sign_in"
  | "needs_connectors"
  | "unavailable"
  | "error";
type ConnectorApp = {
  available: boolean;
  connected: boolean;
  installUrl?: string;
};
type ConnectorStatus = {
  selectedHost: ConnectorHost;
  effectiveHost: EffectiveHost;
  status: ConnectorState;
  hosts: {
    codex: { available: boolean };
    claude: { available: boolean };
    directGoogle: { available: boolean };
  };
  apps: {
    drive: ConnectorApp;
    gmail: ConnectorApp;
  };
  message?: string;
};

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  services: { drive: boolean; gmail: boolean; contacts: boolean };
  credentialFile: string;
  error?: string;
};

type GoogleConfig = {
  configured: boolean;
  source: "environment" | "oauth-client.json" | null;
  credentialFile: string;
  redirectUri: string;
  error?: string;
};

type GoogleWorkspace = {
  folder: { name: string; webViewLink: string };
  outreach: { name: string; webViewLink: string };
};

const HOST_OPTIONS: { id: ConnectorHost; label: string; blurb: string }[] = [
  {
    id: "auto",
    label: "Automatic (recommended)",
    blurb: "Detect an available local connector host, then verify Drive and Gmail independently before using them.",
  },
  {
    id: "codex",
    label: "Codex",
    blurb: "Use the Google apps connected to Codex on this machine.",
  },
  {
    id: "claude",
    label: "Claude Code",
    blurb: "Use only the Google connector capabilities detected in this Claude Code installation and account.",
  },
  {
    id: "direct-google",
    label: "Direct Google (advanced)",
    blurb: "Bypass connector hosts and manage a separate Google OAuth client for this installation.",
  },
];

const APP_COPY = {
  drive: {
    label: "Google Drive",
    blurb: "Required for native Docs and the managed Contacts and History Sheet.",
  },
  gmail: {
    label: "Gmail",
    blurb: "Optional. Creates drafts for review; Studio Assistant does not expose a send action.",
  },
} as const;

async function responseBody<T>(response: Response) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed with status ${response.status}.`);
  return body;
}

function hostLabel(host: EffectiveHost | ConnectorHost) {
  if (host === "codex") return "Codex";
  if (host === "claude") return "Claude Code";
  if (host === "direct-google") return "Direct Google";
  return "Automatic";
}

function statusLabel(status: ConnectorStatus) {
  const effective = status.effectiveHost ? hostLabel(status.effectiveHost) : null;
  switch (status.status) {
    case "ready":
      return effective ? `${effective} connected` : "Google services connected";
    case "needs_host":
      return "Connector host needed";
    case "needs_sign_in":
      return effective ? `Sign in to ${effective}` : "Connector sign-in needed";
    case "needs_connectors":
      return effective ? `Connect Google apps in ${effective}` : "Google apps need connection";
    case "unavailable":
      return effective ? `${effective} is unavailable` : "Google connectors unavailable";
    case "error":
      return "Connector setup needs attention";
  }
}

export function GoogleAccountPanel() {
  const [connector, setConnector] = useState<ConnectorStatus | null>(null);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [busyHost, setBusyHost] = useState(false);
  const [busyApp, setBusyApp] = useState<keyof ConnectorStatus["apps"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig | null>(null);
  const [workspace, setWorkspace] = useState<GoogleWorkspace | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [clientJson, setClientJson] = useState("");
  const [replacingClient, setReplacingClient] = useState(false);

  const mounted = useRef(true);
  const pollTimer = useRef<number | null>(null);

  const loadDirectGoogle = useCallback(async () => {
    try {
      const [statusResponse, configResponse] = await Promise.all([
        clientFetch("/api/google/status", { cache: "no-store" }),
        clientFetch("/api/google/config", { cache: "no-store" }),
      ]);
      const [nextStatus, nextConfig] = await Promise.all([
        responseBody<GoogleStatus>(statusResponse),
        responseBody<GoogleConfig>(configResponse),
      ]);
      if (!mounted.current) return;
      setGoogleStatus(nextStatus);
      setGoogleConfig(nextConfig);
      if (nextStatus.error || nextConfig.error) setError(nextStatus.error ?? nextConfig.error ?? null);

      if (nextStatus.connected && nextStatus.services.drive) {
        try {
          const workspaceResponse = await clientFetch("/api/google/workspace", { cache: "no-store" });
          const nextWorkspace = await responseBody<GoogleWorkspace>(workspaceResponse);
          if (mounted.current) setWorkspace(nextWorkspace);
        } catch (caught) {
          if (mounted.current) {
            setWorkspace(null);
            setError(caught instanceof Error ? caught.message : "Could not open the Google workspace.");
          }
        }
      } else {
        setWorkspace(null);
      }
    } catch (caught) {
      if (mounted.current) {
        setGoogleStatus(null);
        setGoogleConfig(null);
        setWorkspace(null);
        setError(caught instanceof Error ? caught.message : "Could not read advanced Google settings.");
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await clientFetch("/api/connectors/status", { cache: "no-store" });
      const next = await responseBody<ConnectorStatus>(response);
      if (!mounted.current) return null;
      setConnector(next);
      setError(next.status === "error" ? next.message || "Could not inspect connector capabilities." : null);
      if (next.selectedHost === "direct-google") {
        await loadDirectGoogle();
      } else {
        setGoogleStatus(null);
        setGoogleConfig(null);
        setWorkspace(null);
        setAdvancedOpen(false);
        setReplacingClient(false);
      }
      return next;
    } catch (caught) {
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : "Could not inspect connector capabilities.");
      }
      return null;
    }
  }, [loadDirectGoogle]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, [refresh]);

  const startPolling = useCallback((app: keyof ConnectorStatus["apps"]) => {
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    const deadline = Date.now() + 2 * 60_000;
    pollTimer.current = window.setInterval(() => {
      if (Date.now() >= deadline) {
        if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
        pollTimer.current = null;
        return;
      }
      void refresh().then((next) => {
        if (next?.apps[app].connected && pollTimer.current !== null) {
          window.clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
      });
    }, 1500);
  }, [refresh]);

  const selectHost = useCallback(async (selectedHost: ConnectorHost) => {
    setBusyHost(true);
    setError(null);
    try {
      const response = await clientFetch("/api/connectors/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedHost }),
      });
      await responseBody<ConnectorStatus>(response);
      if (mounted.current) {
        setHostPickerOpen(false);
        setAdvancedOpen(false);
      }
      await refresh();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not select the connector host.");
    } finally {
      if (mounted.current) setBusyHost(false);
    }
  }, [refresh]);

  const connectApp = useCallback(async (app: keyof ConnectorStatus["apps"]) => {
    setBusyApp(app);
    setError(null);
    try {
      const response = await clientFetch("/api/connectors/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app }),
      });
      const body = await responseBody<{ installUrl: string | null; status: ConnectorStatus }>(response);
      if (mounted.current) setConnector(body.status);
      if (body.installUrl) {
        window.open(body.installUrl, "studio-assistant-connector", "noopener,noreferrer");
        startPolling(app);
      } else if (mounted.current) {
        setError(body.status.message || `No ${APP_COPY[app].label} setup link is available for this host.`);
      }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : `Could not connect ${APP_COPY[app].label}.`);
    } finally {
      if (mounted.current) setBusyApp(null);
    }
  }, [startPolling]);

  const saveClient = useCallback(async () => {
    setBusyHost(true);
    setError(null);
    try {
      const response = await clientFetch("/api/google/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clientJson.trim()
            ? { json: clientJson }
            : { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
        ),
      });
      await responseBody<GoogleConfig>(response);
      if (mounted.current) {
        setClientId("");
        setClientSecret("");
        setClientJson("");
        setReplacingClient(false);
      }
      await refresh();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not save the Google OAuth client.");
    } finally {
      if (mounted.current) setBusyHost(false);
    }
  }, [clientId, clientJson, clientSecret, refresh]);

  const disconnectDirectGoogle = useCallback(async () => {
    setBusyHost(true);
    setError(null);
    try {
      const response = await clientFetch("/api/google/disconnect", { method: "POST" });
      const body = await responseBody<{ warning?: string; status: GoogleStatus }>(response);
      if (mounted.current) {
        setGoogleStatus(body.status);
        setConfirmDisconnect(false);
        setError(body.warning ?? null);
      }
      await refresh();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not disconnect Google.");
    } finally {
      if (mounted.current) setBusyHost(false);
    }
  }, [refresh]);

  if (!connector) return <p className="api-key-note">Checking connector capabilities…</p>;

  const selected = HOST_OPTIONS.find((option) => option.id === connector.selectedHost) ?? HOST_OPTIONS[0];
  const directMode = connector.selectedHost === "direct-google";

  return (
    <div className="composer-panel">
      <div className="composer-panel-summary">
        <span className="composer-chip" data-warn={connector.status === "ready" ? "false" : "true"}>
          <span aria-hidden="true" />
          {statusLabel(connector)}
        </span>
        <button disabled={busyHost || busyApp !== null} onClick={() => setHostPickerOpen((value) => !value)} type="button">
          {hostPickerOpen ? "Close" : "Change host"}
        </button>
      </div>

      <p className="api-key-note">
        Selected: <strong>{selected.label}</strong>
        {connector.selectedHost === "auto" && connector.effectiveHost
          ? ` · ${hostLabel(connector.effectiveHost)} detected for this installation.`
          : "."}
      </p>
      {connector.message ? <p className="composer-panel-hint">{connector.message}</p> : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      {hostPickerOpen ? (
        <div className="composer-panel-body">
          <ul>
            {HOST_OPTIONS.map((option) => {
              const unavailable =
                (option.id === "codex" && !connector.hosts.codex.available)
                || (option.id === "claude" && !connector.hosts.claude.available);
              return (
                <li key={option.id}>
                  <button
                    data-current={connector.selectedHost === option.id ? "true" : "false"}
                    disabled={busyHost}
                    onClick={() => void selectHost(option.id)}
                    type="button"
                  >
                    <span className="composer-option-name">
                      {option.label}{unavailable ? " · not detected" : ""}
                    </span>
                    <span className="composer-option-blurb">{option.blurb}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="composer-panel-hint">
            Automatic does not assume every host has the same Google tools. It enables only capabilities reported by
            the detected installation and account.
          </p>
        </div>
      ) : null}

      <div className="composer-panel-body">
        <ul>
          {(Object.keys(APP_COPY) as (keyof typeof APP_COPY)[]).map((appId) => {
            const app = connector.apps[appId];
            const canOpenSetup = app.connected || app.available || Boolean(app.installUrl) || connector.status === "needs_sign_in";
            const unavailable = !canOpenSetup || connector.status === "needs_host" || connector.status === "unavailable";
            const action = app.connected ? "Manage" : connector.status === "needs_sign_in" ? "Sign in" : "Connect";
            return (
              <li key={appId}>
                <button
                  data-current={app.connected ? "true" : "false"}
                  disabled={busyApp !== null || busyHost || unavailable}
                  onClick={() => void connectApp(appId)}
                  type="button"
                >
                  <span className="composer-option-name">
                    {APP_COPY[appId].label} · {busyApp === appId ? "Opening…" : app.connected ? "Connected" : app.available ? action : "Not detected"}
                  </span>
                  <span className="composer-option-blurb">
                    {APP_COPY[appId].blurb}{app.connected ? ` Select to manage it in ${hostLabel(connector.effectiveHost || connector.selectedHost)}.` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {directMode ? (
        <>
          <p className="composer-panel-warning">
            Advanced mode requires a separate Google Cloud OAuth client and stores its token on this machine. Most
            installations should use Automatic instead. This compatibility path also keeps identity in Google
            Contacts rather than using the managed Sheet as the only contact store.
          </p>
          <div className="composer-panel-summary composer-panel-body">
            <span className="composer-chip" data-warn={!googleConfig?.configured ? "true" : "false"}>
              <span aria-hidden="true" />
              {googleConfig?.configured ? "Direct OAuth client configured" : "Direct OAuth client needed"}
            </span>
            <button disabled={busyHost} onClick={() => setAdvancedOpen((value) => !value)} type="button">
              {advancedOpen ? "Hide advanced" : "Show advanced"}
            </button>
          </div>

          {advancedOpen ? (
            <div className="composer-panel-body">
              {!googleConfig ? <p className="api-key-note">Checking direct Google settings…</p> : null}
              {googleStatus?.connected ? (
                <>
                  <p className="api-key-note">
                    Direct account: <strong>{googleStatus.email || "Google connected"}</strong>.
                  </p>
                  {workspace ? (
                    <div className="google-workspace-links">
                      <a href={workspace.folder.webViewLink} rel="noreferrer" target="_blank">Open Drive folder</a>
                      <a href={workspace.outreach.webViewLink} rel="noreferrer" target="_blank">Open Contacts and History Sheet</a>
                    </div>
                  ) : null}
                  {!confirmDisconnect ? (
                    <div className="api-key-entry">
                      <button disabled={busyHost} onClick={() => setConfirmDisconnect(true)} type="button">Disconnect direct Google</button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {googleConfig && (!googleConfig.configured || replacingClient) ? (
                <>
                  <p className="api-key-note">
                    {replacingClient ? "Replace the saved client with " : "Create "}a Google OAuth client with
                    application type <strong>Desktop app</strong>, then paste its downloaded JSON below. You can also
                    enter the client ID and secret separately. The saved values never return to the page.
                  </p>
                  {replacingClient ? (
                    <p className="settings-error">
                      A different OAuth client may not rediscover Drive files created through the old client. Keep the
                      old client unless you are deliberately migrating this installation.
                    </p>
                  ) : null}
                  <label>
                    Desktop OAuth JSON
                    <textarea
                      autoCapitalize="none"
                      autoComplete="off"
                      onChange={(event) => setClientJson(event.target.value)}
                      placeholder={'{"installed":{"client_id":"…","client_secret":"…"}}'}
                      rows={5}
                      spellCheck={false}
                      value={clientJson}
                    />
                  </label>
                  <p className="api-key-note">Or enter the two values:</p>
                  <div className="api-key-entry">
                    <label>
                      <span>OAuth client ID</span>
                      <input
                        autoCapitalize="none"
                        autoComplete="off"
                        disabled={Boolean(clientJson.trim())}
                        onChange={(event) => setClientId(event.target.value)}
                        spellCheck={false}
                        value={clientId}
                      />
                    </label>
                    <label>
                      <span>OAuth client secret</span>
                      <input
                        autoCapitalize="none"
                        autoComplete="off"
                        disabled={Boolean(clientJson.trim())}
                        onChange={(event) => setClientSecret(event.target.value)}
                        spellCheck={false}
                        type="password"
                        value={clientSecret}
                      />
                    </label>
                    <button
                      disabled={busyHost || (!clientJson.trim() && !clientId.trim())}
                      onClick={() => void saveClient()}
                      type="button"
                    >
                      {busyHost ? "Saving…" : replacingClient ? "Replace OAuth client" : "Save OAuth client"}
                    </button>
                    {replacingClient ? (
                      <button disabled={busyHost} onClick={() => setReplacingClient(false)} type="button">Cancel</button>
                    ) : null}
                  </div>
                  <p className="api-key-note">
                    Stored at <code>{googleConfig.credentialFile}</code>. Callback: <code>{googleConfig.redirectUri}</code>.
                  </p>
                </>
              ) : null}

              {googleConfig?.configured && !replacingClient ? (
                googleConfig.source === "oauth-client.json" ? (
                  <div className="api-key-entry">
                    <button disabled={busyHost} onClick={() => setReplacingClient(true)} type="button">Replace OAuth client</button>
                  </div>
                ) : (
                  <p className="api-key-note">
                    This OAuth client comes from environment variables. Change it there, then restart the app.
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          {confirmDisconnect ? (
            <div className="ableton-installer-confirm" data-open="true">
              <div>
                <p>This removes the direct Google token from this machine and asks Google to revoke it.</p>
                <div>
                  <button disabled={busyHost} onClick={() => void disconnectDirectGoogle()} type="button">
                    {busyHost ? "Disconnecting…" : "Confirm disconnect"}
                  </button>
                  <button disabled={busyHost} onClick={() => setConfirmDisconnect(false)} type="button">Cancel</button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
