/** Echoed indices distinguish legacy replies to different tracks/clips. */
export function replyPrefix(address: string, args: (string | number | boolean)[]) {
  const count = address.startsWith("/live/clip/") || address.startsWith("/live/clip_slot/") || address.startsWith("/live/device/") ? 2 : address.startsWith("/live/track/") ? 1 : 0;
  return args.slice(0, count);
}
export function matchesPrefix(prefix: unknown[], values: unknown[]) {
  return prefix.every((value, index) => values[index] === value);
}
