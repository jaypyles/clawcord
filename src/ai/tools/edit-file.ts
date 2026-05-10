import { readFile, writeFile } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";
import { resolveToolPath } from "./resolve-tool-path";

export const editFileTool = tool({
  description:
    "Replace the first occurrence of oldText with newText in a UTF-8 text file under the project playground folder or under ~/.config.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe(
        "Path: relative to playground, or relative to home as '.config/...', or absolute under playground or ~/.config. '~/' is expanded.",
      ),
    oldText: z
      .string()
      .describe("Exact substring to find and replace once (first match only)."),
    newText: z.string().describe("Replacement text (may be empty)."),
  }),
  execute: async ({ path: filePath, oldText, newText }) => {
    logToolStart("edit_file", { path: filePath });
    try {
      const resolved = resolveToolPath(filePath);
      const before = await readFile(resolved, "utf8");
      if (!before.includes(oldText)) {
        logToolError("edit_file", "oldText not found in file", {
          path: resolved,
        });
        return {
          success: false,
          error:
            "oldText was not found in the file. Ensure it matches exactly (including whitespace).",
        };
      }
      const after = before.replace(oldText, newText);
      await writeFile(resolved, after, "utf8");
      logToolSuccess("edit_file", { path: resolved });
      return { success: true, path: resolved };
    } catch (error) {
      logToolError("edit_file", error, { path: filePath });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
