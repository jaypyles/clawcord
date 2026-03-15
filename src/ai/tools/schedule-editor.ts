import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const DEFAULT_AGENT_CORE_DIR = resolve(process.cwd(), "agent-core");
const AGENT_CORE_DIR =
  env.AGENT_CORE_DIR && env.AGENT_CORE_DIR.trim().length > 0
    ? env.AGENT_CORE_DIR
    : DEFAULT_AGENT_CORE_DIR;
const SCHEDULE_FILE_PATH = resolve(AGENT_CORE_DIR, "SCHEDULE.md");
const HEADER = `# SCHEDULE

Cron-scheduled prompts. The agent runs each prompt at the given cron time (5-field: minute hour day-of-month month day-of-week, or 6-field with seconds).

## Jobs (JSONL)
\`\`\`jsonl
\`\`\`
`;

type ScheduleJob = {
  id: string;
  createdAt: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  discordChannelId?: string;
};

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function extractJsonlBlock(markdown: string): {
  before: string;
  body: string;
  after: string;
} {
  const match = normalize(markdown).match(
    /([\s\S]*?## Jobs \(JSONL\)\s*\n\s*```jsonl\n)([\s\S]*?)(\n```[\s\S]*)/,
  );

  if (!match) {
    return {
      before: `${markdown.trimEnd()}\n\n## Jobs (JSONL)\n\`\`\`jsonl\n`,
      body: "",
      after: "\n```\n",
    };
  }

  return {
    before: match[1] ?? "",
    body: match[2] ?? "",
    after: match[3] ?? "",
  };
}

function parseJobs(body: string): ScheduleJob[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as ScheduleJob;
      } catch {
        return null;
      }
    })
    .filter((job): job is ScheduleJob => Boolean(job));
}

function renderJobs(jobs: ScheduleJob[]): string {
  if (jobs.length === 0) {
    return "";
  }
  return `${jobs.map((job) => JSON.stringify(job)).join("\n")}\n`;
}

async function ensureScheduleFile(): Promise<void> {
  await mkdir(dirname(SCHEDULE_FILE_PATH), { recursive: true });
  try {
    await readFile(SCHEDULE_FILE_PATH, "utf8");
  } catch {
    await writeFile(SCHEDULE_FILE_PATH, HEADER, "utf8");
  }
}

export const scheduleEditorTool = tool({
  description:
    "Read and update cron-scheduled jobs in agent-core/SCHEDULE.md. Each job has a cron expression (5-field: minute hour day month dow, e.g. '0 9 * * *' for 9am daily) and a prompt to send to the agent. Use schedule_editor to list, add, enable/disable, or delete scheduled jobs.",
  inputSchema: z.object({
    action: z.enum(["read", "add", "set_enabled", "delete"]),
    id: z
      .string()
      .optional()
      .describe("Job id (required for set_enabled/delete)."),
    cron: z
      .string()
      .optional()
      .describe(
        "Cron expression: 5 fields (minute hour day-of-month month day-of-week), e.g. '0 9 * * *' for 9:00 daily. Required for add.",
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        "Prompt to send to the agent at schedule time. Required for add.",
      ),
    enabled: z.boolean().optional().describe("Enabled state for set_enabled."),
    discordChannelId: z
      .string()
      .optional()
      .describe(
        "Optional Discord channel ID to post the agent reply to when the job runs.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe("Number of jobs to return for read."),
  }),
  execute: async (input) => {
    logToolStart("schedule_editor", {
      action: input.action,
      id: input.id ?? null,
    });
    try {
      await ensureScheduleFile();
      const markdown = await readFile(SCHEDULE_FILE_PATH, "utf8");
      const block = extractJsonlBlock(markdown);
      const jobs = parseJobs(block.body);

      if (input.action === "read") {
        const recent = [...jobs].slice(-input.limit).reverse();
        logToolSuccess("schedule_editor", {
          action: "read",
          count: recent.length,
        });
        return {
          ok: true,
          filePath: SCHEDULE_FILE_PATH,
          count: recent.length,
          jobs: recent,
        };
      }

      if (input.action === "add") {
        if (!input.cron || !input.prompt) {
          return {
            ok: false,
            error: "cron and prompt are required for add.",
          };
        }

        const job: ScheduleJob = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          cron: input.cron.trim(),
          prompt: input.prompt,
          enabled: true,
          ...(input.discordChannelId && {
            discordChannelId: input.discordChannelId,
          }),
        };
        const nextJobs = [...jobs, job];
        const nextMarkdown = `${block.before}${renderJobs(nextJobs)}${block.after}`;
        await writeFile(SCHEDULE_FILE_PATH, nextMarkdown, "utf8");
        logToolSuccess("schedule_editor", { action: "add", id: job.id });
        return {
          ok: true,
          filePath: SCHEDULE_FILE_PATH,
          job,
        };
      }

      if (!input.id) {
        return {
          ok: false,
          error: "id is required for this action.",
        };
      }

      if (input.action === "set_enabled") {
        if (typeof input.enabled !== "boolean") {
          return {
            ok: false,
            error: "enabled is required for set_enabled.",
          };
        }
        const nextJobs = jobs.map((job) =>
          job.id === input.id
            ? { ...job, enabled: input.enabled ?? job.enabled }
            : job,
        );
        const nextMarkdown = `${block.before}${renderJobs(nextJobs)}${block.after}`;
        await writeFile(SCHEDULE_FILE_PATH, nextMarkdown, "utf8");
        logToolSuccess("schedule_editor", {
          action: "set_enabled",
          id: input.id,
          enabled: input.enabled,
        });
        return {
          ok: true,
          filePath: SCHEDULE_FILE_PATH,
          id: input.id,
          enabled: input.enabled,
        };
      }

      const nextJobs = jobs.filter((job) => job.id !== input.id);
      const deleted = nextJobs.length !== jobs.length;
      const nextMarkdown = `${block.before}${renderJobs(nextJobs)}${block.after}`;
      await writeFile(SCHEDULE_FILE_PATH, nextMarkdown, "utf8");
      logToolSuccess("schedule_editor", {
        action: "delete",
        id: input.id,
        deleted,
      });
      return {
        ok: true,
        filePath: SCHEDULE_FILE_PATH,
        id: input.id,
        deleted,
      };
    } catch (error) {
      logToolError("schedule_editor", error, {
        action: input.action,
        id: input.id ?? null,
      });
      return {
        ok: false,
        filePath: SCHEDULE_FILE_PATH,
        error:
          error instanceof Error
            ? error.message
            : "Unknown schedule editor error",
      };
    }
  },
});

export { ensureScheduleFile, extractJsonlBlock, parseJobs, SCHEDULE_FILE_PATH };
export type { ScheduleJob };
