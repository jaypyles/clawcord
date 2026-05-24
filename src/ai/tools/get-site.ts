import { tool } from "ai";
import { z } from "zod";

import { fetchSite } from "../../utils/page-reader";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

export type { Webpage } from "../../utils/page-reader";

const MAX_RESPONSE_PREVIEW = 12_000;

function truncateText(value: string, max = MAX_RESPONSE_PREVIEW): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

const getSiteInputSchema = z.object({
  url: z.string().url().describe("URL to load in a headless browser"),
  selector: z
    .string()
    .optional()
    .describe("Optional CSS selector to extract a specific element"),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .optional()
    .default(30_000),
  maxResponseChars: z
    .number()
    .int()
    .min(200)
    .max(100_000)
    .optional()
    .default(MAX_RESPONSE_PREVIEW),
});

export const getSiteTool = tool({
  description:
    "Load a URL in a headless browser and return sanitized HTML plus markdown. Use for JS-rendered pages; prefer http_fetch for APIs and static JSON.",
  inputSchema: getSiteInputSchema,
  execute: async (input) => {
    logToolStart("get_site", {
      url: input.url,
      selector: input.selector,
      timeoutMs: input.timeoutMs,
    });
    const startedAt = Date.now();

    try {
      const page = await fetchSite({
        url: input.url,
        selector: input.selector,
        timeoutMs: input.timeoutMs,
      });
      const maxChars = input.maxResponseChars;
      const markdownPreview = truncateText(page.markdown, maxChars);
      const htmlPreview = truncateText(page.html, maxChars);

      const output = {
        url: page.url,
        selector: input.selector ?? null,
        elapsedMs: Date.now() - startedAt,
        markdown: {
          preview: markdownPreview,
          length: page.markdown.length,
          truncated: markdownPreview.length < page.markdown.length,
        },
        html: {
          preview: htmlPreview,
          length: page.html.length,
          truncated: htmlPreview.length < page.html.length,
        },
      };

      logToolSuccess("get_site", {
        url: output.url,
        elapsedMs: output.elapsedMs,
        markdownLength: output.markdown.length,
      });
      return output;
    } catch (error) {
      logToolError("get_site", error, { url: input.url });
      return {
        url: input.url,
        selector: input.selector ?? null,
        elapsedMs: Date.now() - startedAt,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message:
            error instanceof Error ? error.message : "Unknown get_site error",
        },
      };
    }
  },
});
