const MAX_JSON_CHARS = 1500;
const MAX_LOG_STRING = 500;
const MAX_ERROR_OUTPUT_CHARS = 4000;

function formatLogText(text: string, max = MAX_LOG_STRING): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

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

  if (typeof value === "string" && value.length > MAX_LOG_STRING) {
    return formatLogText(value);
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
  console.error(`[tool:error] ${toolName} ${message}`);

  if (!payload || typeof payload !== "object") {
    if (payload !== undefined) {
      console.error(`[tool:error] ${toolName} ${toPreview(payload)}`);
    }
    return;
  }

  const record = payload as Record<string, unknown>;
  const stdout =
    typeof record.stdout === "string" ? record.stdout.trim() : "";
  const stderr =
    typeof record.stderr === "string" ? record.stderr.trim() : "";

  if (stdout) {
    console.error(
      `[tool:error] ${toolName} stdout:\n${formatLogText(stdout, MAX_ERROR_OUTPUT_CHARS)}`
    );
  }
  if (stderr) {
    console.error(
      `[tool:error] ${toolName} stderr:\n${formatLogText(stderr, MAX_ERROR_OUTPUT_CHARS)}`
    );
  }

  const { stdout: _stdout, stderr: _stderr, ...meta } = record;
  if (Object.keys(meta).length > 0) {
    console.error(`[tool:error] ${toolName} meta ${toPreview(meta)}`);
  }
}
