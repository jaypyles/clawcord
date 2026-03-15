import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
const COMMANDS_FILE_PATH = resolve(AGENT_CORE_DIR, "COMMANDS.md");
const DEFAULT_REGISTRY_HEADER = "# Commands Registry\n\n";

type ParsedCommand = {
  trigger: string;
  heading: string;
  name: string;
  description: string;
  args: string[];
  workflow: string[];
  example: string;
  notes: string[];
  raw: string;
};

function extractSection(
  sectionBody: string,
  heading: string
): string {
  const regex = new RegExp(
    `###\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`,
    "i"
  );
  const match = sectionBody.match(regex);
  return match?.[1]?.trim() ?? "";
}

function extractListItems(value: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+\.)\s+/, "").trim());
}

function parseCommandSection(rawSection: string): ParsedCommand {
  const lines = rawSection.split("\n");
  const headingLine = lines[0]?.replace(/^##\s+/, "").trim() ?? "";
  const triggerMatch = headingLine.match(/(!\S+)/);
  const trigger = triggerMatch?.[1] ?? headingLine.split(/\s+/)[0] ?? "";
  const nameMatch = headingLine.match(/\(([^)]+)\)/);
  const name = nameMatch?.[1]?.trim() ?? headingLine;
  const body = lines.slice(1).join("\n");

  const description = extractSection(body, "Description");
  const args = extractListItems(extractSection(body, "Args"));
  const workflow = extractListItems(extractSection(body, "Workflow"));
  const example = extractSection(body, "Example");
  const notes = extractListItems(extractSection(body, "Notes"));

  return {
    trigger,
    heading: headingLine,
    name,
    description,
    args,
    workflow,
    example,
    notes,
    raw: rawSection.trim()
  };
}

function parseCommands(content: string): ParsedCommand[] {
  const split = content.split(/^##\s+/m);
  const sections = split.slice(1).map((section) => `## ${section}`.trim());
  return sections.map(parseCommandSection).filter((command) => command.trigger.length > 0);
}

function formatCommandSection(input: {
  trigger: string;
  name?: string;
  description: string;
  args?: string[];
  workflow?: string[];
  example?: string;
  notes?: string[];
}): string {
  const name = input.name?.trim().length ? input.name.trim() : input.trigger;
  const args = input.args ?? [];
  const workflow = input.workflow ?? [];
  const notes = input.notes ?? [];

  const lines: string[] = [];
  lines.push(`## ${input.trigger} (${name})`);
  lines.push("");
  lines.push("### Description");
  lines.push(input.description.trim());
  lines.push("");
  lines.push("### Args");
  if (args.length === 0) {
    lines.push("- (none)");
  } else {
    for (const arg of args) {
      lines.push(`- ${arg}`);
    }
  }
  lines.push("");
  lines.push("### Workflow");
  if (workflow.length === 0) {
    lines.push("1. (define workflow)");
  } else {
    for (let i = 0; i < workflow.length; i++) {
      lines.push(`${i + 1}. ${workflow[i]}`);
    }
  }
  lines.push("");
  lines.push("### Example");
  lines.push(input.example?.trim().length ? input.example.trim() : input.trigger);
  lines.push("");
  lines.push("### Notes");
  if (notes.length === 0) {
    lines.push("- (none)");
  } else {
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push("");

  return lines.join("\n").trim();
}

async function ensureCommandsFile(): Promise<void> {
  await mkdir(dirname(COMMANDS_FILE_PATH), { recursive: true });
  try {
    await access(COMMANDS_FILE_PATH);
  } catch {
    await writeFile(COMMANDS_FILE_PATH, DEFAULT_REGISTRY_HEADER, "utf8");
  }
}

export const commandsRegistryTool = tool({
  description:
    "Read and edit the command registry in agent-core/COMMANDS.md. Supports list, read, and upsert.",
  inputSchema: z.object({
    action: z.enum(["list", "read", "upsert"]),
    trigger: z
      .string()
      .optional()
      .describe("Command trigger, e.g. !sv"),
    name: z.string().optional(),
    description: z.string().optional(),
    args: z.array(z.string()).optional(),
    workflow: z.array(z.string()).optional(),
    example: z.string().optional(),
    notes: z.array(z.string()).optional()
  }),
  execute: async (input) => {
    logToolStart("commands_registry", {
      action: input.action,
      trigger: input.trigger ?? null
    });

    try {
      await ensureCommandsFile();
      const content = await readFile(COMMANDS_FILE_PATH, "utf8");
      const commands = parseCommands(content);

      if (input.action === "list") {
        const entries = commands.map((command) => ({
          trigger: command.trigger,
          name: command.name,
          description: command.description
        }));
        logToolSuccess("commands_registry", {
          action: "list",
          count: entries.length
        });
        return {
          ok: true,
          filePath: COMMANDS_FILE_PATH,
          count: entries.length,
          commands: entries
        };
      }

      if (input.action === "read") {
        if (!input.trigger) {
          return {
            ok: false,
            error: "trigger is required for read action."
          };
        }

        const found = commands.find((command) => command.trigger === input.trigger);
        if (!found) {
          return {
            ok: false,
            filePath: COMMANDS_FILE_PATH,
            error: `No command found for trigger ${input.trigger}.`
          };
        }

        logToolSuccess("commands_registry", {
          action: "read",
          trigger: found.trigger
        });
        return {
          ok: true,
          filePath: COMMANDS_FILE_PATH,
          command: {
            trigger: found.trigger,
            name: found.name,
            description: found.description,
            args: found.args,
            workflow: found.workflow,
            example: found.example,
            notes: found.notes
          }
        };
      }

      if (!input.trigger || !input.description) {
        return {
          ok: false,
          error: "trigger and description are required for upsert action."
        };
      }

      const newSection = formatCommandSection({
        trigger: input.trigger,
        name: input.name,
        description: input.description,
        args: input.args,
        workflow: input.workflow,
        example: input.example,
        notes: input.notes
      });

      const existing = commands.find((command) => command.trigger === input.trigger);
      let updatedContent: string;
      if (existing) {
        updatedContent = content.replace(existing.raw, newSection);
      } else {
        updatedContent = content.trimEnd();
        if (!updatedContent.endsWith("\n")) {
          updatedContent += "\n";
        }
        updatedContent += `\n${newSection}\n`;
      }

      await writeFile(COMMANDS_FILE_PATH, updatedContent, "utf8");
      logToolSuccess("commands_registry", {
        action: "upsert",
        trigger: input.trigger,
        updatedExisting: Boolean(existing)
      });
      return {
        ok: true,
        filePath: COMMANDS_FILE_PATH,
        trigger: input.trigger,
        updatedExisting: Boolean(existing)
      };
    } catch (error) {
      logToolError("commands_registry", error, {
        action: input.action,
        trigger: input.trigger ?? null
      });
      return {
        ok: false,
        filePath: COMMANDS_FILE_PATH,
        error: error instanceof Error ? error.message : "Unknown commands registry error"
      };
    }
  }
});
