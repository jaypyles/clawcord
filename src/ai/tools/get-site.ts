import { tool } from "ai";
import { z } from "zod";

import { fetchSite } from "../../utils/page-reader";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

export type { Webpage } from "../../utils/page-reader";

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
});

export const getSiteTool = tool({
  description:
    "Load a URL in a headless browser and return the full page as markdown in the `markdown` field. Read that field to answer. Use for JS-rendered pages; prefer http_fetch for APIs and static JSON.",
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

      if (page.markdown.trim().length === 0) {
        return {
          url: page.url,
          success: false,
          error:
            "Page loaded but markdown was empty (login wall, bot block, or no text). Try another source.",
          markdownLength: 0,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const output = {
        url: page.url,
        success: true,
        markdown: page.markdown,
        markdownLength: page.markdown.length,
        selector: input.selector ?? null,
        elapsedMs: Date.now() - startedAt,
      };

      logToolSuccess("get_site", {
        url: output.url,
        elapsedMs: output.elapsedMs,
        markdownLength: output.markdownLength,
      });
      return output;
    } catch (error) {
      logToolError("get_site", error, { url: input.url });
      return {
        url: input.url,
        success: false,
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
