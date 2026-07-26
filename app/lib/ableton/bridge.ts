import dgram from "node:dgram";
import dns from "node:dns/promises";
import { readPacket, writePacket, type OscArg } from "osc";
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
    const waiter = queue?.shift();
    if (!waiter) return;
    if (queue && queue.length === 0) state.waiters.delete(key);

    clearTimeout(waiter.timer);
    waiter.resolve(message.args.map((arg) => arg.value));
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

async function resolveHost(host: string): Promise<string> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    return address;
  } catch {
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
  state.socket.send(packet, OSC_SEND_PORT, ip);
}

/** Send and wait for the echoed-address reply. Times out with a readable error. */
export async function oscQuery(
  address: string,
  args: (string | number | boolean)[] = [],
  options: { host?: string; timeoutMs?: number } = {},
): Promise<unknown[]> {
  const host = options.host ?? currentAbletonHost();
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  const state = getState();
  await state.ready;
  const ip = await resolveHost(host);
  const key = `${ip}|${address}`;

  return new Promise<unknown[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      const queue = state.waiters.get(key);
      if (queue) {
        const index = queue.findIndex((entry) => entry.timer === timer);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) state.waiters.delete(key);
      }
      reject(new Error(notReachableMessage(host)));
    }, timeoutMs);

    const queue = state.waiters.get(key) ?? [];
    queue.push({ resolve, reject, timer });
    state.waiters.set(key, queue);

    const packet = writePacket({ address, args: toOscArgs(args) }, { metadata: true });
    state.socket.send(packet, OSC_SEND_PORT, ip, (error) => {
      if (error) {
        clearTimeout(timer);
        reject(new Error(notReachableMessage(host)));
      }
    });
  });
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

  const values = await oscQuery("/live/application/get/version", [], { host, timeoutMs: 900 });
  const version = values.map(String).join(".");
  state.handshakes.set(host, { version, at: Date.now() });
  return version;
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
