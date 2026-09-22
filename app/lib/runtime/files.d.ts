export function atomicWrite(target: string, content: string | Uint8Array): void;
export function readJson<T>(target: string, fallback: T): T;
export function writeJson(target: string, value: unknown): void;
