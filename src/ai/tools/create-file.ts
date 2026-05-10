import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";
import { resolveToolPath } from "./resolve-tool-path";

export const createFileTool = tool({
  description:
    "Create or overwrite a UTF-8 text file anywhere the process can write (e.g. mounted volumes in Docker). Creates parent directories as needed.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe(
        "Absolute path, or relative to the process working directory. '~/' expands to the container user's home.",
      ),
    text: z.string().describe("Full file contents to write."),
  }),
  execute: async ({ path: filePath, text }) => {
    logToolStart("create_file", { path: filePath });
    try {
      const resolved = resolveToolPath(filePath);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, text, "utf8");
      logToolSuccess("create_file", { path: resolved });
      return { success: true, path: resolved };
    } catch (error) {
      logToolError("create_file", error, { path: filePath });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
