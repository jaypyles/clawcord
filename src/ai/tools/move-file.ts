import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";
import { resolveToolPath } from "./resolve-tool-path";

function wouldNestInsideSource(fromResolved: string, toResolved: string): boolean {
  const fromNorm = resolve(fromResolved);
  const toNorm = resolve(toResolved);
  if (fromNorm === toNorm) {
    return true;
  }
  const prefix = fromNorm.endsWith(sep) ? fromNorm : `${fromNorm}${sep}`;
  return toNorm === fromNorm || toNorm.startsWith(prefix);
}

export const moveFileTool = tool({
  description:
    "Move or rename a file or directory. Creates all missing parent directories on the destination path before moving. Uses rename when possible; copies then deletes if crossing filesystems (EXDEV).",
  inputSchema: z.object({
    from: z
      .string()
      .min(1)
      .describe(
        "Source path (file or folder). Absolute or relative to cwd; '~/' expanded.",
      ),
    to: z
      .string()
      .min(1)
      .describe(
        "Destination path. Parent directories are created if missing. Must not be inside the source path.",
      ),
  }),
  execute: async ({ from: fromPath, to: toPath }) => {
    logToolStart("move_file", { from: fromPath, to: toPath });
    try {
      const fromResolved = resolveToolPath(fromPath);
      const toResolved = resolveToolPath(toPath);

      if (wouldNestInsideSource(fromResolved, toResolved)) {
        const msg =
          "Destination cannot be the same as the source or a path inside the source.";
        logToolError("move_file", msg, { from: fromResolved, to: toResolved });
        return { success: false, error: msg };
      }

      await mkdir(dirname(toResolved), { recursive: true });

      try {
        await rename(fromResolved, toResolved);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code === "EXDEV") {
          await cp(fromResolved, toResolved, { recursive: true, force: true });
          await rm(fromResolved, { recursive: true, force: true });
        } else {
          throw err;
        }
      }

      logToolSuccess("move_file", { from: fromResolved, to: toResolved });
      return { success: true, from: fromResolved, to: toResolved };
    } catch (error) {
      logToolError("move_file", error, { from: fromPath, to: toPath });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
