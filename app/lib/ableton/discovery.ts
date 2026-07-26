import os from "node:os";
import { Bonjour } from "bonjour-service";
import { probeHost } from "@/lib/ableton/bridge";
import { readSettings } from "@/lib/settings";

/**
 * Find Macs on the local network that might be running Ableton Live, by
 * browsing Bonjour for common Mac services and then probing every candidate
 * with an AbletonOSC version query. "reachable" means Live is open there with
 * the AbletonOSC control surface enabled; a host can be up without it.
 */

export type DiscoveredHost = {
  host: string;
  name: string;
  current: boolean;
  reachable: boolean;
  version?: string;
};

const BROWSE_TYPES = ["ssh", "sftp-ssh", "smb", "rfb", "airplay", "device-info", "companion-link"];
const BROWSE_MS = 1800;

function normalize(host: string): string {
  return host.replace(/\.$/, "").toLowerCase();
}

function isSelf(host: string): boolean {
  const own = normalize(os.hostname());
  const candidate = normalize(host);
  return candidate === own || candidate.replace(/\.local$/, "") === own.replace(/\.local$/, "");
}

export async function discoverAbletonHosts(): Promise<DiscoveredHost[]> {
  const found = new Map<string, { host: string; name: string }>();
  const bonjour = new Bonjour();

  await new Promise<void>((resolve) => {
    for (const type of BROWSE_TYPES) {
      bonjour.find({ type }, (service) => {
        const host = (service.host || "").replace(/\.$/, "");
        if (!host || isSelf(host)) return;
        const key = normalize(host);
        if (!found.has(key)) {
          found.set(key, { host, name: host.replace(/\.local$/i, "").replace(/-/g, " ") });
        }
      });
    }
    setTimeout(resolve, BROWSE_MS);
  });
  bonjour.destroy();

  const current = readSettings().abletonHost;
  const candidates = [{ host: "127.0.0.1", name: "This Mac" }, ...Array.from(found.values())];
  if (!candidates.some((entry) => normalize(entry.host) === normalize(current))) {
    candidates.push({ host: current, name: current.replace(/\.local$/i, "") });
  }

  return Promise.all(
    candidates.map(async (candidate) => {
      const probe = await probeHost(candidate.host);
      return {
        ...candidate,
        current: normalize(candidate.host) === normalize(current),
        reachable: probe.reachable,
        ...(probe.version ? { version: probe.version } : {}),
      };
    }),
  );
}
