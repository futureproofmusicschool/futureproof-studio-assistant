// Minimal typings for the parts of the "osc" package the bridge uses.
declare module "osc" {
  export type OscArg = { type: string; value: unknown };
  export type OscMessage = { address: string; args: OscArg[] };
  export function writePacket(message: OscMessage, options?: { metadata?: boolean }): Uint8Array;
  export function readPacket(
    data: Uint8Array | Buffer,
    options?: { metadata?: boolean },
  ): OscMessage & { packets?: unknown[] };
}
