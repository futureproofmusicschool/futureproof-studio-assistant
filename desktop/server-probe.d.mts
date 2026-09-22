export function probeServer(options: { port: number; timeoutMs?: number }): Promise<"studio" | "occupied" | "empty">;
