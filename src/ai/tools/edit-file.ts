import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const PLAYGROUND_ROOT =
  env.PLAYGROUND_DIR && env.PLAYGROUND_DIR.trim().length > 0
    ? env.PLAYGROUND_DIR
    : resolve(process.cwd(), "playground");

function ensurePlaygroundPath(inputPath: string): string {
  const fullPath = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(PLAYGROUND_ROOT, inputPath);
  const normalizedRoot = resolve(PLAYGROUND_ROOT);
  const normalizedPath = resolve(fullPath);
  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(
      `path must be inside the playground folder: ${normalizedRoot}`,
    );
  }
  return normalizedPath;
}

export const editFileTool = tool({
  description:
    "Replace the first occurrence of oldText with newText in a UTF-8 text file under the playground folder.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe(
        "File path relative to the playground folder, or absolute path inside that folder.",
      ),
    oldText: z
      .string()
      .describe("Exact substring to find and replace once (first match only)."),
    newText: z.string().describe("Replacement text (may be empty)."),
  }),
  execute: async ({ path: filePath, oldText, newText }) => {
    logToolStart("edit_file", { path: filePath });
    try {
      const resolved = ensurePlaygroundPath(filePath);
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
