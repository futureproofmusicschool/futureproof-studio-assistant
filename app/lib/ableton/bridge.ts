import crypto from "node:crypto";
import { SingleFlight } from "../single-flight";
import { writeJson } from "../runtime/files.js";
import { replyPrefix, matchesPrefix } from "./replies";
import dgram from "node:dgram";
import dns from "node:dns/promises";
import fs from "node:fs";
import { readPacket, writePacket, type OscArg } from "osc";
import { dataPath, ensureDataDirectory } from "@/lib/paths";
import { readSettings } from "@/lib/settings";

/**
 * OSC bridge to the AbletonOSC Remote Script (vendored in ableton/AbletonOSC).
 * AbletonOSC listens on UDP 11000 inside Live and replies to the sender's host
 * on UDP 11001, echoing the request address. One socket serves every host, so
 * the same bridge talks to Live on this machine or on another Mac on the LAN
 * (settings.json "abletonHost"), and discovery can probe many hosts at once.
 *
 * Request/response over fire-and-forget UDP works the way Kadence's bridge
 * proved out: send, register a one-shot waiter keyed by (host IP, address),
 * resolve on the matching reply or time out. Sets and method calls mostly get
 * no reply; callers read state back when confirmation matters.
 */

const OSC_SEND_PORT = 11000;
const OSC_REPLY_PORT = 11001;
const QUERY_TIMEOUT_MS = 1200;
const HANDSHAKE_TTL_MS = 5000;

type Waiter = {
  resolve: (values: unknown[]) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  prefix: unknown[];
};

type BridgeState = {
  socket: dgram.Socket;
  ready: Promise<void>;
  waiters: Map<string, Waiter[]>;
  handshakes: Map<string, { version: string; at: number }>;
};

// One socket per process, surviving Next dev hot reloads.
const globalStore = globalThis as unknown as { __abletonBridge?: BridgeState };

function getState(): BridgeState {
  if (globalStore.__abletonBridge) return globalStore.__abletonBridge;

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const state: BridgeState = {
    socket,
    waiters: new Map(),
    handshakes: new Map(),
    ready: new Promise((resolve, reject) => {
      socket.once("error", (error) => reject(new Error(`Ableton bridge socket failed: ${error.message}`)));
      socket.bind(OSC_REPLY_PORT, "0.0.0.0", () => resolve());
    }),
  };

  socket.on("message", (data, rinfo) => {
    let message: { address: string; args: OscArg[] };
    try {
      message = readPacket(data, { metadata: true });
    } catch {
      return;
    }
    if (!message.address) return;

    const key = `${rinfo.address}|${message.address}`;
    const queue = state.waiters.get(key);
    const values = message.args.map((arg) => arg.value);
    const index = queue?.findIndex((entry) => matchesPrefix(entry.prefix, values)) ?? -1;
    const waiter = index >= 0 ? queue?.splice(index, 1)[0] : undefined;
    if (!waiter) return;
    if (queue && queue.length === 0) state.waiters.delete(key);

    clearTimeout(waiter.timer);
    waiter.resolve(values);
  });

  globalStore.__abletonBridge = state;
  return state;
}

function toOscArgs(args: (string | number | boolean)[]): OscArg[] {
  return args.map((value) => {
    if (typeof value === "string") return { type: "s", value };
    if (typeof value === "boolean") return { type: "i", value: value ? 1 : 0 };
    if (Number.isInteger(value)) return { type: "i", value };
    return { type: "f", value };
  });
}

/**
 * Last known IP for each hostname, on disk so it survives restarts.
 *
 * A ".local" name is resolved by mDNS, and mDNS is granted per launching
 * process tree by macOS Local Network permission. Launch the server from a
 * process that was never granted it and resolution fails silently: no error
 * anyone sees, just "Ableton isn't reachable" for a machine that is sitting
 * right there answering on 11000. Caching the address means one successful
 * resolution keeps that machine reachable afterwards, whatever launched us.
 *
 * The hostname stays the identity because it survives DHCP moving the address;
 * the cache is only the fallback. Both failing at once (name unresolvable AND
 * the lease moved) still needs a rescan or a hand-typed address.
 */
const HOST_CACHE_FILE = "ableton-hosts.json";

function readHostCache(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(dataPath(HOST_CACHE_FILE), "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function rememberHost(host: string, ip: string): void {
  const cache = readHostCache();
  if (cache[host] === ip) return;
  try {
    ensureDataDirectory();
    writeJson(dataPath(HOST_CACHE_FILE), { ...cache, [host]: ip });
  } catch {
    // A read-only checkout must not break Ableton control.
  }
}

const resolvedHosts = new Map<string, { until: number; ip: string }>();
const resolutions = new SingleFlight<string>();
function resolveHost(host: string): Promise<string> {
  const cached = resolvedHosts.get(host);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.ip);
  return resolutions.run(host, async () => {
    const ip = await lookupHost(host);
    resolvedHosts.set(host, { until: Date.now() + 30_000, ip });
    return ip;
  });
}
async function lookupHost(host: string): Promise<string> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    rememberHost(host, address);
    return address;
  } catch {
    const cached = readHostCache()[host];
    if (cached) return cached;
    throw new Error(`Can't resolve "${host}" on the network. Check the machine name in Ableton settings.`);
  }
}

export function currentAbletonHost(): string {
  return readSettings().abletonHost;
}

export function notReachableMessage(host: string): string {
  const where = host === "127.0.0.1" ? "this machine" : host;
  return (
    `Ableton isn't reachable on ${where}. Live is probably closed, or the AbletonOSC ` +
    `control surface isn't enabled (Live Preferences, Link Tempo & MIDI, Control Surface).`
  );
}

/** Send with no reply expected (set/* and most method calls). */
export async function oscSend(
  address: string,
  args: (string | number | boolean)[] = [],
  host = currentAbletonHost(),
): Promise<void> {
  const state = getState();
  await state.ready;
  const ip = await resolveHost(host);
  const packet = writePacket({ address, args: toOscArgs(args) }, { metadata: true });
  await new Promise<void>((resolve, reject) => state.socket.send(packet, OSC_SEND_PORT, ip, (error) => error ? reject(error) : resolve()));
}

/** Send and wait for the echoed-address reply. Times out with a readable error. */
async function legacyQuery(
  address: string,
  args: (string | number | boolean)[] = [],
  options: { host?: string; timeoutMs?: number; requestId?: string } = {},
): Promise<unknown[]> {
  const host = options.host ?? currentAbletonHost();
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  const state = getState();
  await state.ready;
  const ip = await resolveHost(host);
  const key = `${ip}|${options.requestId ? "/studio/reply" : address}`;

  return new Promise<unknown[]>((resolve, reject) => {
    const remove = () => {
      const queue = state.waiters.get(key);
      if (queue) {
        const index = queue.findIndex((entry) => entry.timer === timer);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) state.waiters.delete(key);
      }
    };
    const timer = setTimeout(() => { remove(); resolvedHosts.delete(host); reject(new Error(notReachableMessage(host))); }, timeoutMs);

    const queue = state.waiters.get(key) ?? [];
    queue.push({ resolve, reject, timer, prefix: options.requestId ? [options.requestId] : replyPrefix(address, args) });
    state.waiters.set(key, queue);

    const packet = writePacket({ address, args: toOscArgs(args) }, { metadata: true });
    state.socket.send(packet, OSC_SEND_PORT, ip, (error) => {
      if (error) {
        clearTimeout(timer);
        remove();
        reject(new Error(notReachableMessage(host)));
      }
    });
  });
}

const queries = new SingleFlight<unknown[]>();
const handshakes = new SingleFlight<string>();
const protocols = new Map<string, { until: number; correlated: boolean }>();
const protocolProbes = new SingleFlight<{ until: number; correlated: boolean }>();
const legacyTails = new Map<string, Promise<unknown>>();
export function oscQuery(address: string, args: (string | number | boolean)[] = [], options: { host?: string; timeoutMs?: number } = {}): Promise<unknown[]> {
  const host = options.host ?? currentAbletonHost();
  const read = address.includes("/get/");
  const work = async () => {
    let protocol = protocols.get(host);
    if (!protocol || protocol.until <= Date.now()) {
      protocol = await protocolProbes.run(host, async () => {
      let correlated = false;
      try { correlated = (await legacyQuery("/studio/capabilities", [], { host, timeoutMs: 300 }))[0] === "request-id-v1"; } catch { /* Older installed script. */ }
      const result = { until: Date.now() + 60_000, correlated };
      protocols.set(host, result);
      return result;
      });
    }
    if (read && protocol.correlated) {
      const requestId = crypto.randomUUID();
      const response = await legacyQuery("/studio/query", [requestId, address, ...args], { ...options, host, requestId });
      if (response[2] !== 0) throw new Error(String(response[3] || "Ableton query failed."));
      return response.slice(3);
    }
    // Old scripts cannot echo request IDs. Keep each address family ordered.
    const key = `${host}:${address}`;
    const before = legacyTails.get(key) ?? Promise.resolve();
    const pending = before.then(() => legacyQuery(address, args, { ...options, host }), () => legacyQuery(address, args, { ...options, host }));
    legacyTails.set(key, pending);
    void pending.finally(() => { if (legacyTails.get(key) === pending) legacyTails.delete(key); }).catch(() => {});
    return pending;
  };
  return read ? queries.run(`${host}:${address}:${JSON.stringify(args)}`, work) : work();
}

/**
 * Handshake: confirm Live + AbletonOSC answer on the host. Cached briefly so
 * bursts of tool calls don't re-verify every time. Throws the readable
 * not-reachable error on failure.
 */
export async function ensureLive(host = currentAbletonHost()): Promise<string> {
  const state = getState();
  const cached = state.handshakes.get(host);
  if (cached && Date.now() - cached.at < HANDSHAKE_TTL_MS) return cached.version;

  return handshakes.run(host, async () => {
    const values = await oscQuery("/live/application/get/version", [], { host, timeoutMs: 900 });
    const version = values.map(String).join(".");
    state.handshakes.set(host, { version, at: Date.now() });
    return version;
  });
}

/** Non-throwing reachability check for the health endpoint and discovery. */
export async function probeHost(host: string): Promise<{ reachable: boolean; version?: string }> {
  try {
    const version = await ensureLive(host);
    return { reachable: true, version };
  } catch {
    return { reachable: false };
  }
}
