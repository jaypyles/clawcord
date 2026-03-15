import { tool } from "ai";
import { z } from "zod";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const MAX_RESPONSE_PREVIEW = 12_000;

function truncateText(value: string, max = MAX_RESPONSE_PREVIEW): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function objectFromHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    out[key] = value;
  }
  return out;
}

const fetchInputSchema = z.object({
  url: z.string().url().describe("URL to fetch"),
  method: z.string().optional().describe("HTTP method, e.g. GET, POST, PUT, DELETE"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers as key/value pairs"),
  query: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Extra query params appended to URL"),
  bodyText: z.string().optional().describe("Raw request body as plain text"),
  bodyJson: z
    .unknown()
    .optional()
    .describe("Request JSON body. Auto-sets content-type if not already set"),
  bodyFormUrlEncoded: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("application/x-www-form-urlencoded body"),
  bodyBase64: z.string().optional().describe("Request body encoded as base64"),
  redirect: z.enum(["follow", "error", "manual"]).optional(),
  credentials: z.enum(["omit", "same-origin", "include"]).optional(),
  mode: z.enum(["cors", "no-cors", "same-origin"]).optional(),
  cache: z
    .enum([
      "default",
      "no-store",
      "reload",
      "no-cache",
      "force-cache",
      "only-if-cached"
    ])
    .optional(),
  referrer: z.string().optional(),
  referrerPolicy: z
    .enum([
      "",
      "no-referrer",
      "no-referrer-when-downgrade",
      "origin",
      "origin-when-cross-origin",
      "same-origin",
      "strict-origin",
      "strict-origin-when-cross-origin",
      "unsafe-url"
    ])
    .optional(),
  integrity: z.string().optional(),
  keepalive: z.boolean().optional(),
  duplex: z.enum(["half"]).optional().describe("Required for some streaming request bodies"),
  timeoutMs: z.number().int().min(1).max(120_000).optional().default(15_000),
  responseFormat: z
    .enum(["auto", "text", "json", "base64"])
    .optional()
    .default("auto")
    .describe("How response body should be decoded"),
  maxResponseChars: z.number().int().min(200).max(100_000).optional().default(12_000)
});

export const httpFetchTool = tool({
  description:
    "Verbose native-like HTTP fetch tool. Supports method, headers, query params, body types, and most RequestInit options.",
  inputSchema: fetchInputSchema,
  execute: async (input) => {
    logToolStart("http_fetch", {
      url: input.url,
      method: input.method ?? "GET",
      responseFormat: input.responseFormat
    });
    const startedAt = Date.now();
    const targetUrl = new URL(input.url);

    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        targetUrl.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers(input.headers ?? {});
    let body: RequestInit["body"] | undefined;

    if (input.bodyJson !== undefined) {
      body = JSON.stringify(input.bodyJson);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    } else if (input.bodyFormUrlEncoded) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(input.bodyFormUrlEncoded)) {
        form.set(key, String(value));
      }
      body = form.toString();
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }
    } else if (input.bodyBase64) {
      body = Buffer.from(input.bodyBase64, "base64");
    } else if (input.bodyText !== undefined) {
      body = input.bodyText;
    }

    const init: RequestInit = {
      method: input.method,
      headers,
      body,
      redirect: input.redirect,
      credentials: input.credentials,
      mode: input.mode,
      cache: input.cache,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      integrity: input.integrity,
      keepalive: input.keepalive
    };

    if (input.duplex) {
      (init as RequestInit & { duplex?: "half" }).duplex = input.duplex;
    }

    try {
      const response = await fetch(targetUrl, {
        ...init,
        signal: AbortSignal.timeout(input.timeoutMs)
      });

      const contentType = response.headers.get("content-type") ?? "";
      const elapsedMs = Date.now() - startedAt;
      const responseHeaders = objectFromHeaders(response.headers);
      const maxChars = input.maxResponseChars;

      if (input.responseFormat === "base64") {
        const bytes = await response.arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");
        const output = {
          request: {
            url: targetUrl.toString(),
            method: init.method ?? "GET",
            headers: objectFromHeaders(headers),
            hasBody: body !== undefined
          },
          response: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            redirected: response.redirected,
            finalUrl: response.url,
            type: response.type,
            headers: responseHeaders,
            contentType,
            elapsedMs
          },
          body: {
            format: "base64",
            base64Preview: truncateText(base64, maxChars),
            byteLength: Buffer.byteLength(base64, "utf8")
          }
        };
        logToolSuccess("http_fetch", {
          status: output.response.status,
          elapsedMs: output.response.elapsedMs,
          format: output.body.format
        });
        return output;
      }

      const rawText = await response.text();
      const textPreview = truncateText(rawText, maxChars);

      if (input.responseFormat === "json" || (input.responseFormat === "auto" && contentType.includes("application/json"))) {
        try {
          const parsed = JSON.parse(rawText);
          const output = {
            request: {
              url: targetUrl.toString(),
              method: init.method ?? "GET",
              headers: objectFromHeaders(headers),
              hasBody: body !== undefined
            },
            response: {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              redirected: response.redirected,
              finalUrl: response.url,
              type: response.type,
              headers: responseHeaders,
              contentType,
              elapsedMs
            },
            body: {
              format: "json",
              parsedJson: parsed,
              textPreview,
              truncated: textPreview.length < rawText.length
            }
          };
          logToolSuccess("http_fetch", {
            status: output.response.status,
            elapsedMs: output.response.elapsedMs,
            format: output.body.format
          });
          return output;
        } catch {
          // Fall through to text response when JSON parsing fails.
        }
      }

      const output = {
        request: {
          url: targetUrl.toString(),
          method: init.method ?? "GET",
          headers: objectFromHeaders(headers),
          hasBody: body !== undefined
        },
        response: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
          finalUrl: response.url,
          type: response.type,
          headers: responseHeaders,
          contentType,
          elapsedMs
        },
        body: {
          format: "text",
          textPreview,
          textLength: rawText.length,
          truncated: textPreview.length < rawText.length
        }
      };
      logToolSuccess("http_fetch", {
        status: output.response.status,
        elapsedMs: output.response.elapsedMs,
        format: output.body.format
      });
      return output;
    } catch (error) {
      logToolError("http_fetch", error, { url: targetUrl.toString() });
      return {
        request: {
          url: targetUrl.toString(),
          method: init.method ?? "GET",
          headers: objectFromHeaders(headers),
          hasBody: body !== undefined
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : "Unknown fetch error"
        },
        elapsedMs: Date.now() - startedAt
      };
    }
  }
});
