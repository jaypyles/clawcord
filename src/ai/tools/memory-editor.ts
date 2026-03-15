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
const MEMORY_FILE_PATH = resolve(AGENT_CORE_DIR, "MEMORY.md");
const HEADER = `# MEMORY

Persistent memory entries for agent behavior and context.

## Structured Entries (JSONL)
\`\`\`jsonl
\`\`\`
`;

type MemoryEntry = {
  id: string;
  createdAt: string;
  category: string;
  importance: "low" | "medium" | "high";
  tags: string[];
  content: string;
};

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function extractJsonlBlock(markdown: string): { before: string; body: string; after: string } {
  const normalized = normalize(markdown);
  const sectionMatch = normalized.match(
    /([\s\S]*?## Structured Entries \(JSONL\)\n)([\s\S]*)/
  );

  if (!sectionMatch) {
    return {
      before: `${markdown.trimEnd()}\n\n## Structured Entries (JSONL)\n\`\`\`jsonl\n`,
      body: "",
      after: "\n```\n"
    };
  }

  const before = sectionMatch[1] + "```jsonl\n";
  const rest = sectionMatch[2] ?? "";
  const blockRegex = /```jsonl\n([\s\S]*?)\n```/g;
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(rest)) !== null) {
    bodies.push((m[1] ?? "").trim());
  }
  const body = bodies.join("\n");

  return {
    before,
    body,
    after: "\n```\n"
  };
}

function parseEntries(body: string): MemoryEntry[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as MemoryEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is MemoryEntry => Boolean(entry));
}

function renderEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

async function ensureMemoryFile(): Promise<void> {
  await mkdir(dirname(MEMORY_FILE_PATH), { recursive: true });
  try {
    await readFile(MEMORY_FILE_PATH, "utf8");
  } catch {
    await writeFile(MEMORY_FILE_PATH, HEADER, "utf8");
  }
}

export const memoryEditorTool = tool({
  description:
    "Read and update structured memory entries in agent-core/MEMORY.md using a JSONL-backed format.",
  inputSchema: z.object({
    action: z.enum(["read", "add", "delete"]),
    id: z.string().optional().describe("Entry id (required for delete)."),
    category: z.string().optional().describe("Memory category (required for add)."),
    importance: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Importance level for add."),
    tags: z.array(z.string()).optional().describe("Optional tags for add."),
    content: z.string().optional().describe("Memory content (required for add)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Number of most recent entries for read.")
  }),
  execute: async (input) => {
    logToolStart("memory_editor", { action: input.action, id: input.id ?? null });
    try {
      await ensureMemoryFile();
      const markdown = await readFile(MEMORY_FILE_PATH, "utf8");
      const block = extractJsonlBlock(markdown);
      const entries = parseEntries(block.body);

      if (input.action === "read") {
        const recent = [...entries].slice(-input.limit).reverse();
        logToolSuccess("memory_editor", {
          action: "read",
          count: recent.length
        });
        return {
          ok: true,
          filePath: MEMORY_FILE_PATH,
          count: recent.length,
          entries: recent
        };
      }

      if (input.action === "add") {
        if (!input.category || !input.content) {
          return {
            ok: false,
            error: "category and content are required for add."
          };
        }

        const entry: MemoryEntry = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          category: input.category,
          importance: input.importance ?? "medium",
          tags: input.tags ?? [],
          content: input.content
        };
        const nextEntries = [...entries, entry];
        const nextMarkdown = `${block.before}${renderEntries(nextEntries)}${block.after}`;
        await writeFile(MEMORY_FILE_PATH, nextMarkdown, "utf8");
        logToolSuccess("memory_editor", { action: "add", id: entry.id });
        return {
          ok: true,
          filePath: MEMORY_FILE_PATH,
          entry
        };
      }

      if (!input.id) {
        return {
          ok: false,
          error: "id is required for delete."
        };
      }

      const nextEntries = entries.filter((entry) => entry.id !== input.id);
      const deleted = nextEntries.length !== entries.length;
      const nextMarkdown = `${block.before}${renderEntries(nextEntries)}${block.after}`;
      await writeFile(MEMORY_FILE_PATH, nextMarkdown, "utf8");
      logToolSuccess("memory_editor", { action: "delete", id: input.id, deleted });
      return {
        ok: true,
        filePath: MEMORY_FILE_PATH,
        id: input.id,
        deleted
      };
    } catch (error) {
      logToolError("memory_editor", error, { action: input.action, id: input.id ?? null });
      return {
        ok: false,
        filePath: MEMORY_FILE_PATH,
        error: error instanceof Error ? error.message : "Unknown memory editor error"
      };
    }
  }
});
