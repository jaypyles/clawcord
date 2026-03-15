import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { tool } from "ai";
import { z } from "zod";

import { env } from "../../config/env";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const DEFAULT_AGENT_CORE_DIR = resolve(process.cwd(), "agent-core");
const AGENT_CORE_DIR =
  env.AGENT_CORE_DIR && env.AGENT_CORE_DIR.trim().length > 0
    ? env.AGENT_CORE_DIR
    : DEFAULT_AGENT_CORE_DIR;
const BEHAVIOR_FILE_PATH = resolve(AGENT_CORE_DIR, "BEHAVIOR.md");
const HEADER = `# BEHAVIOR

Structured behavior rules for response style and decision making.

## Structured Rules (JSONL)
\`\`\`jsonl
\`\`\`
`;

type BehaviorRule = {
  id: string;
  createdAt: string;
  priority: "low" | "medium" | "high";
  instruction: string;
  rationale: string;
  enabled: boolean;
};

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function extractJsonlBlock(markdown: string): { before: string; body: string; after: string } {
  const match = normalize(markdown).match(
    /([\s\S]*?## Structured Rules \(JSONL\)\n```jsonl\n)([\s\S]*?)(\n```[\s\S]*)/
  );

  if (!match) {
    return {
      before: `${markdown.trimEnd()}\n\n## Structured Rules (JSONL)\n\`\`\`jsonl\n`,
      body: "",
      after: "\n```\n"
    };
  }

  return {
    before: match[1] ?? "",
    body: match[2] ?? "",
    after: match[3] ?? ""
  };
}

function parseRules(body: string): BehaviorRule[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as BehaviorRule;
      } catch {
        return null;
      }
    })
    .filter((rule): rule is BehaviorRule => Boolean(rule));
}

function renderRules(rules: BehaviorRule[]): string {
  if (rules.length === 0) {
    return "";
  }
  return `${rules.map((rule) => JSON.stringify(rule)).join("\n")}\n`;
}

async function ensureBehaviorFile(): Promise<void> {
  await mkdir(dirname(BEHAVIOR_FILE_PATH), { recursive: true });
  try {
    await readFile(BEHAVIOR_FILE_PATH, "utf8");
  } catch {
    await writeFile(BEHAVIOR_FILE_PATH, HEADER, "utf8");
  }
}

export const behaviorEditorTool = tool({
  description:
    "Read and update structured behavior rules in agent-core/BEHAVIOR.md using a JSONL-backed format.",
  inputSchema: z.object({
    action: z.enum(["read", "add", "set_enabled", "delete"]),
    id: z.string().optional().describe("Rule id (required for set_enabled/delete)."),
    instruction: z.string().optional().describe("Behavior instruction (required for add)."),
    rationale: z.string().optional().describe("Optional rationale for add."),
    priority: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Rule priority for add."),
    enabled: z.boolean().optional().describe("Enabled state for set_enabled."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Number of most recent rules for read.")
  }),
  execute: async (input) => {
    logToolStart("behavior_editor", { action: input.action, id: input.id ?? null });
    try {
      await ensureBehaviorFile();
      const markdown = await readFile(BEHAVIOR_FILE_PATH, "utf8");
      const block = extractJsonlBlock(markdown);
      const rules = parseRules(block.body);

      if (input.action === "read") {
        const recent = [...rules].slice(-input.limit).reverse();
        logToolSuccess("behavior_editor", { action: "read", count: recent.length });
        return {
          ok: true,
          filePath: BEHAVIOR_FILE_PATH,
          count: recent.length,
          rules: recent
        };
      }

      if (input.action === "add") {
        if (!input.instruction) {
          return {
            ok: false,
            error: "instruction is required for add."
          };
        }

        const rule: BehaviorRule = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          priority: input.priority ?? "medium",
          instruction: input.instruction,
          rationale: input.rationale ?? "",
          enabled: true
        };
        const nextRules = [...rules, rule];
        const nextMarkdown = `${block.before}${renderRules(nextRules)}${block.after}`;
        await writeFile(BEHAVIOR_FILE_PATH, nextMarkdown, "utf8");
        logToolSuccess("behavior_editor", { action: "add", id: rule.id });
        return {
          ok: true,
          filePath: BEHAVIOR_FILE_PATH,
          rule
        };
      }

      if (!input.id) {
        return {
          ok: false,
          error: "id is required for this action."
        };
      }

      if (input.action === "set_enabled") {
        if (typeof input.enabled !== "boolean") {
          return {
            ok: false,
            error: "enabled is required for set_enabled."
          };
        }
        const nextRules = rules.map((rule) =>
          rule.id === input.id ? { ...rule, enabled: input.enabled ?? rule.enabled } : rule
        );
        const updated = nextRules.some(
          (rule, index) => rule.enabled !== rules[index]?.enabled && rule.id === input.id
        );
        const nextMarkdown = `${block.before}${renderRules(nextRules)}${block.after}`;
        await writeFile(BEHAVIOR_FILE_PATH, nextMarkdown, "utf8");
        logToolSuccess("behavior_editor", {
          action: "set_enabled",
          id: input.id,
          updated
        });
        return {
          ok: true,
          filePath: BEHAVIOR_FILE_PATH,
          id: input.id,
          updated,
          enabled: input.enabled
        };
      }

      const nextRules = rules.filter((rule) => rule.id !== input.id);
      const deleted = nextRules.length !== rules.length;
      const nextMarkdown = `${block.before}${renderRules(nextRules)}${block.after}`;
      await writeFile(BEHAVIOR_FILE_PATH, nextMarkdown, "utf8");
      logToolSuccess("behavior_editor", { action: "delete", id: input.id, deleted });
      return {
        ok: true,
        filePath: BEHAVIOR_FILE_PATH,
        id: input.id,
        deleted
      };
    } catch (error) {
      logToolError("behavior_editor", error, {
        action: input.action,
        id: input.id ?? null
      });
      return {
        ok: false,
        filePath: BEHAVIOR_FILE_PATH,
        error: error instanceof Error ? error.message : "Unknown behavior editor error"
      };
    }
  }
});
