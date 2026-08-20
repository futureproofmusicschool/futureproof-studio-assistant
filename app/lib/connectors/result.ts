export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Connector text can also contain a human summary around its JSON.
    }
  }
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject !== -1 && lastObject > firstObject) {
    try {
      return JSON.parse(trimmed.slice(firstObject, lastObject + 1));
    } catch {
      // Leave the text intact below.
    }
  }
  return trimmed;
}

function contentPayload(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined;
  const values = content.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (item.type === "text" && typeof item.text === "string") return [parseJsonText(item.text)];
    if (item.type === "resource" && isRecord(item.resource) && typeof item.resource.text === "string") {
      return [parseJsonText(item.resource.text)];
    }
    return [];
  }).filter((value) => value !== undefined);
  return values.length === 1 ? values[0] : values.length ? values : undefined;
}

/**
 * Codex and Claude wrap MCP results slightly differently, and connector
 * versions have changed those wrappers more than once. Normalize only the
 * transport envelopes here; domain parsers still validate the data they need.
 */
export function unwrapConnectorResult(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isRecord(current)) return current;
    if (current.isError === true) {
      const message = connectorErrorText(current) || "The Google connector reported an error.";
      throw new Error(message);
    }
    if (current.structuredContent !== undefined && current.structuredContent !== null) {
      current = current.structuredContent;
      continue;
    }
    const fromContent = contentPayload(current.content);
    if (fromContent !== undefined) {
      current = fromContent;
      continue;
    }
    if (Object.keys(current).length === 1 && "result" in current) {
      current = current.result;
      continue;
    }
    if (Object.keys(current).length === 1 && "data" in current) {
      current = current.data;
      continue;
    }
    return current;
  }
  return current;
}

export function connectorErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(connectorErrorText).filter(Boolean).join("\n");
  }
  if (!isRecord(value)) return "";
  for (const key of ["error", "message", "detail", "reason"]) {
    const candidate = connectorErrorText(value[key]);
    if (candidate) return candidate;
  }
  const content = contentPayload(value.content);
  return typeof content === "string" ? content : "";
}

export function walkRecords(value: unknown): JsonRecord[] {
  const records: JsonRecord[] = [];
  const seen = new Set<unknown>();
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 10 || candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = candidate as JsonRecord;
    records.push(record);
    Object.values(record).forEach((item) => visit(item, depth + 1));
  };
  visit(unwrapConnectorResult(value), 0);
  return records;
}

export function firstString(value: unknown, keys: readonly string[]) {
  for (const record of walkRecords(value)) {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return null;
}

export function firstArray(value: unknown, keys: readonly string[]) {
  for (const record of walkRecords(value)) {
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return null;
}
