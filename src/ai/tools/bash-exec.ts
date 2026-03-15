import { exec } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const execAsync = promisify(exec);
const MAX_PREVIEW_CHARS = 3500;
const BASH_TIMEOUT_MS = 10_000;
const SKILLS_DIR = resolve(homedir(), ".config/clawcord/skills");

function trimPreview(text: string): string {
  return text.length > MAX_PREVIEW_CHARS
    ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n...[truncated]`
    : text;
}

function hasBlockedPattern(command: string): boolean {
  const blocked = [
    /rm\s+-rf\s+\//i,
    /mkfs/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
  ];

  return blocked.some((pattern) => pattern.test(command));
}

function isWithinSkillsDir(path: string): boolean {
  return path === SKILLS_DIR || path.startsWith(`${SKILLS_DIR}${sep}`);
}

async function resolveSkillScriptPath(inputPath: string): Promise<string> {
  const fullPath = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(SKILLS_DIR, inputPath);

  if (!isWithinSkillsDir(fullPath)) {
    throw new Error(
      "bash_exec filePath must be inside ~/.config/clawcord/skills.",
    );
  }

  await access(fullPath);
  return fullPath;
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

export const bashExecTool = tool({
  description:
    "Execute a bash command or script file and return stdout/stderr. Disabled unless ENABLE_BASH_TOOL=true.",
  inputSchema: z
    .object({
      command: z.string().min(1).optional().describe("Bash command to run."),
      filePath: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Path to a shell script file under ~/.config/clawcord/skills. Can be absolute or relative to that directory.",
        ),
      args: z
        .array(z.string())
        .optional()
        .describe("Optional CLI args when running filePath."),
      cwd: z
        .string()
        .min(1)
        .optional()
        .describe("Optional working directory for execution."),
    })
    .refine((value) => Boolean(value.command || value.filePath), {
      message: "Provide either command or filePath.",
    }),
  execute: async ({ command, filePath, args, cwd }) => {
    logToolStart("bash_exec", {
      mode: filePath ? "file" : "command",
      filePath: filePath ?? null,
      hasCommand: Boolean(command),
      argCount: args?.length ?? 0,
      cwd: cwd ?? null,
    });

    if (!env.ENABLE_BASH_TOOL) {
      logToolError("bash_exec", "Tool disabled");
      return {
        success: false,
        error:
          "bash_exec is disabled. Set ENABLE_BASH_TOOL=true in .env to enable it.",
      };
    }

    if (command && hasBlockedPattern(command)) {
      logToolError("bash_exec", "Command blocked by safety policy.", {
        mode: "command",
      });
      return {
        success: false,
        error: "Command blocked by safety policy.",
      };
    }

    try {
      let bashCommand: string;
      if (filePath) {
        const fullPath = await resolveSkillScriptPath(filePath);
        const renderedArgs = (args ?? []).map(shellQuote).join(" ");
        const isPythonScript = extname(fullPath).toLowerCase() === ".py";
        const runner = isPythonScript ? "python3" : "bash";
        bashCommand =
          renderedArgs.length > 0
            ? `${runner} ${shellQuote(fullPath)} ${renderedArgs}`
            : `${runner} ${shellQuote(fullPath)}`;
      } else {
        bashCommand = command ?? "";
      }

      const { stdout, stderr } = await execAsync(
        `bash -lc ${JSON.stringify(bashCommand)}`,
        {
          cwd,
          timeout: BASH_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
      );

      const output = {
        success: true,
        mode: filePath ? "file" : "command",
        filePath: filePath ?? null,
        stdout: trimPreview(stdout),
        stderr: trimPreview(stderr),
      };
      logToolSuccess("bash_exec", {
        mode: output.mode,
        filePath: output.filePath,
      });
      return output;
    } catch (error) {
      const execError = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message: string;
      };

      logToolError("bash_exec", error, {
        mode: filePath ? "file" : "command",
        filePath: filePath ?? null,
      });
      return {
        success: false,
        mode: filePath ? "file" : "command",
        filePath: filePath ?? null,
        code: execError.code ?? null,
        message: execError.message,
        stdout: trimPreview(execError.stdout ?? ""),
        stderr: trimPreview(execError.stderr ?? ""),
      };
    }
  },
});
