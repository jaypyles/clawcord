import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

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

export const createFileTool = tool({
  description:
    "Create or overwrite a UTF-8 text file under the playground folder. Creates parent directories as needed.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe(
        "File path relative to the playground folder, or absolute path inside that folder.",
      ),
    text: z.string().describe("Full file contents to write."),
  }),
  execute: async ({ path: filePath, text }) => {
    logToolStart("create_file", { path: filePath });
    try {
      const resolved = ensurePlaygroundPath(filePath);
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
