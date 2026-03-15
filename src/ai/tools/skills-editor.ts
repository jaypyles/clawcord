import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const SKILLS_DIR = resolve(homedir(), ".config/clawcord/skills");
const DEFAULT_SKILL_FILE = "SKILL.md";

function isWithinSkillsDir(path: string): boolean {
  return path === SKILLS_DIR || path.startsWith(`${SKILLS_DIR}${sep}`);
}

function ensureSafeSkillPath(inputPath: string): string {
  const fullPath = resolve(SKILLS_DIR, inputPath);
  if (!isWithinSkillsDir(fullPath)) {
    throw new Error("Unsafe file path.");
  }
  return fullPath;
}

/** Single path segment: no slashes, no parent refs */
function safeSkillId(skillId: string): boolean {
  return (
    /^[a-zA-Z0-9_.-]+$/.test(skillId) && skillId !== ".." && skillId !== "."
  );
}

function skillPathCandidates(input: string): string[] {
  const candidates: string[] = [];
  candidates.push(input);
  if (!input.endsWith(".md")) {
    candidates.push(`${input}.md`);
  }
  if (
    !input.endsWith(`/${DEFAULT_SKILL_FILE}`) &&
    !input.endsWith(`\\${DEFAULT_SKILL_FILE}`)
  ) {
    candidates.push(join(input, DEFAULT_SKILL_FILE));
  }
  return candidates;
}

async function resolveWritableSkillPath(input: string): Promise<string> {
  for (const candidate of skillPathCandidates(input)) {
    const fullPath = ensureSafeSkillPath(candidate);
    try {
      await readFile(fullPath, "utf8");
      return fullPath;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "Skill not found. Use a skill id or path like 'my-skill' or 'my-skill/SKILL.md'.",
  );
}

async function ensureSkillsDir(): Promise<void> {
  await mkdir(SKILLS_DIR, { recursive: true });
}

export const skillsEditorTool = tool({
  description:
    "Create, update, or delete skills under ~/.config/clawcord/skills. Skills are Markdown files; Claude Code format uses a directory with SKILL.md (e.g. my-skill/SKILL.md). Use skills_reader to list or read skills first.",
  inputSchema: z.object({
    action: z
      .enum(["create", "update", "delete"])
      .describe(
        "Create a new skill, update an existing one, or delete a skill.",
      ),
    skillId: z
      .string()
      .optional()
      .describe(
        "For create: name of the skill (letters, numbers, underscores, hyphens, dots). For update/delete: skill id or path (e.g. 'my-skill' or 'my-skill/SKILL.md').",
      ),
    content: z
      .string()
      .optional()
      .describe(
        "Full Markdown content for create or update. Can include YAML frontmatter (---\\nkey: value\\n---). Required for create and update.",
      ),
    format: z
      .enum(["claude-code", "markdown"])
      .optional()
      .default("claude-code")
      .describe(
        "For create only: 'claude-code' = <skillId>/SKILL.md, 'markdown' = <skillId>.md.",
      ),
  }),
  execute: async (input) => {
    logToolStart("skills_editor", {
      action: input.action,
      skillId: input.skillId ?? null,
    });
    try {
      await ensureSkillsDir();

      if (input.action === "create") {
        if (!input.skillId?.trim()) {
          return { ok: false, error: "skillId is required for create." };
        }
        const id = input.skillId.trim();
        if (!safeSkillId(id)) {
          return {
            ok: false,
            error:
              "skillId must be a single path segment (letters, numbers, underscores, hyphens, dots). No slashes or '..'.",
          };
        }
        if (input.content === undefined) {
          return { ok: false, error: "content is required for create." };
        }
        const content = input.content;
        const isClaudeCode = input.format === "claude-code";
        const relativePath = isClaudeCode
          ? join(id, DEFAULT_SKILL_FILE)
          : `${id}.md`;
        const fullPath = ensureSafeSkillPath(relativePath);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf8");
        logToolSuccess("skills_editor", {
          action: "create",
          skillId: id,
          path: relativePath,
        });
        return {
          ok: true,
          directory: SKILLS_DIR,
          skillId: id,
          path: relativePath,
          fullPath,
        };
      }

      if (input.action === "update") {
        if (!input.skillId?.trim()) {
          return { ok: false, error: "skillId is required for update." };
        }
        if (input.content === undefined) {
          return { ok: false, error: "content is required for update." };
        }
        const fullPath = await resolveWritableSkillPath(input.skillId.trim());
        await writeFile(fullPath, input.content, "utf8");
        logToolSuccess("skills_editor", { action: "update", path: fullPath });
        return {
          ok: true,
          directory: SKILLS_DIR,
          path: fullPath,
        };
      }

      if (input.action === "delete") {
        if (!input.skillId?.trim()) {
          return { ok: false, error: "skillId is required for delete." };
        }
        const fullPath = await resolveWritableSkillPath(input.skillId.trim());
        const isClaudeCode =
          fullPath.endsWith(`${sep}${DEFAULT_SKILL_FILE}`) ||
          fullPath.endsWith(`/${DEFAULT_SKILL_FILE}`);
        if (isClaudeCode) {
          await rm(dirname(fullPath), { recursive: true });
        } else {
          await rm(fullPath, { force: true });
        }
        logToolSuccess("skills_editor", { action: "delete", path: fullPath });
        return {
          ok: true,
          directory: SKILLS_DIR,
          deleted: fullPath,
        };
      }

      return { ok: false, error: "Invalid action." };
    } catch (error) {
      logToolError("skills_editor", error, {
        action: input.action,
        skillId: input.skillId ?? null,
      });
      return {
        ok: false,
        directory: SKILLS_DIR,
        error:
          error instanceof Error
            ? error.message
            : "Unknown skills editor error",
      };
    }
  },
});
