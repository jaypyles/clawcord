const MAX_JSON_CHARS = 1500;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/(authorization|api[-_]?key|token|cookie|password|secret)/i.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redact(val);
      }
    }
    return out;
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}...[truncated]`;
  }

  return value;
}

function toPreview(value: unknown): string {
  try {
    const json = JSON.stringify(redact(value));
    if (!json) {
      return "";
    }
    return json.length > MAX_JSON_CHARS
      ? `${json.slice(0, MAX_JSON_CHARS)}...[truncated]`
      : json;
  } catch {
    return "[unserializable]";
  }
}

export function logToolStart(toolName: string, payload?: unknown): void {
  console.log(`[tool:start] ${toolName} ${toPreview(payload)}`);
}

export function logToolSuccess(toolName: string, payload?: unknown): void {
  console.log(`[tool:success] ${toolName} ${toPreview(payload)}`);
}

export function logToolError(toolName: string, error: unknown, payload?: unknown): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(
    `[tool:error] ${toolName} ${message} ${toPreview(payload)}`
  );
}
