import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { tool } from "ai";
import { z } from "zod";
import { logToolError, logToolStart, logToolSuccess } from "../tool-logger";

const SKILLS_DIR = resolve(homedir(), ".config/justdothething/skills");
const MAX_FILE_PREVIEW_CHARS = 16_000;
const DEFAULT_SKILL_FILE = "SKILL.md";

function truncateText(text: string): string {
  return text.length > MAX_FILE_PREVIEW_CHARS
    ? `${text.slice(0, MAX_FILE_PREVIEW_CHARS)}\n...[truncated]`
    : text;
}

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

function parseFrontmatter(content: string): {
  metadata: Record<string, string>;
  frontmatterRaw: string | null;
  body: string;
} {
  if (!content.startsWith("---\n")) {
    return { metadata: {}, frontmatterRaw: null, body: content };
  }

  const endIdx = content.indexOf("\n---\n", 4);
  if (endIdx === -1) {
    return { metadata: {}, frontmatterRaw: null, body: content };
  }

  const frontmatterRaw = content.slice(4, endIdx);
  const body = content.slice(endIdx + 5);
  const metadata: Record<string, string> = {};

  for (const line of frontmatterRaw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)\s*$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = match[2];
    if (!key || !value) {
      continue;
    }
    metadata[key] = value.replace(/^['"]|['"]$/g, "").trim();
  }

  return { metadata, frontmatterRaw, body };
}

function skillSummary(metadata: Record<string, string>, fallbackId: string): {
  name: string;
  description: string;
} {
  return {
    name: metadata.name ?? fallbackId,
    description:
      metadata.description ??
      "No description provided in SKILL.md frontmatter."
  };
}

function skillPathCandidates(input: string): string[] {
  const candidates = new Set<string>();
  candidates.add(input);

  if (!input.endsWith(".md")) {
    candidates.add(`${input}.md`);
  }
  if (!input.endsWith(`/${DEFAULT_SKILL_FILE}`) && !input.endsWith(`\\${DEFAULT_SKILL_FILE}`)) {
    candidates.add(join(input, DEFAULT_SKILL_FILE));
  }

  return [...candidates];
}

async function resolveReadableSkillPath(input: string): Promise<string> {
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
    "Skill not found. Expected a Markdown file or Claude Code format at <skill>/SKILL.md."
  );
}

async function listSkills() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills: Array<{
    id: string;
    fileName: string;
    relativePath: string;
    format: "claude-code" | "markdown";
    metadata: Record<string, string>;
    name: string;
    description: string;
  }> = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const relativePath = join(entry.name, DEFAULT_SKILL_FILE);
      const fullPath = ensureSafeSkillPath(relativePath);
      try {
        const content = await readFile(fullPath, "utf8");
        const parsed = parseFrontmatter(content);
        skills.push({
          id: entry.name,
          fileName: DEFAULT_SKILL_FILE,
          relativePath,
          format: "claude-code",
          metadata: parsed.metadata,
          ...skillSummary(parsed.metadata, entry.name)
        });
      } catch {
        // Ignore directories without readable SKILL.md
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const relativePath = entry.name;
    const fullPath = ensureSafeSkillPath(relativePath);
    const content = await readFile(fullPath, "utf8");
    const parsed = parseFrontmatter(content);
    skills.push({
      id: entry.name.replace(/\.md$/i, ""),
      fileName: entry.name,
      relativePath,
      format: "markdown",
      metadata: parsed.metadata,
      ...skillSummary(parsed.metadata, entry.name.replace(/\.md$/i, ""))
    });
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

async function listSkillScriptsById(skillId: string): Promise<string[]> {
  const scriptsDir = ensureSafeSkillPath(join(skillId, "scripts"));
  const entries = await readdir(scriptsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(skillId, "scripts", entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export const skillsReaderTool = tool({
  description:
    "List and read local skills from ~/.config/justdothething/skills. Supports Claude Code skill format (<skill>/SKILL.md with frontmatter). Returns explicit skill name and description.",
  inputSchema: z.object({
    action: z
      .enum(["list", "read"])
      .describe("Use 'list' to view available skills or 'read' to read a specific skill file."),
    fileName: z
      .string()
      .optional()
      .describe(
        "Required when action is 'read'. Accepts a skill id, file name, or path like 'my-skill', 'my-skill.md', or 'my-skill/SKILL.md'."
      )
  }),
  execute: async ({ action, fileName }) => {
    logToolStart("skills_reader", { action, fileName: fileName ?? null });
    try {
      if (action === "list") {
        const skills = await listSkills();
        const skillsWithScripts = await Promise.all(
          skills.map(async (skill) => {
            if (skill.format !== "claude-code") {
              return { ...skill, scripts: [] as string[] };
            }

            try {
              const scripts = await listSkillScriptsById(skill.id);
              return { ...skill, scripts };
            } catch {
              return { ...skill, scripts: [] as string[] };
            }
          })
        );

        const output = {
          ok: true,
          directory: SKILLS_DIR,
          skillCount: skillsWithScripts.length,
          skills: skillsWithScripts
        };
        logToolSuccess("skills_reader", {
          action,
          skillCount: output.skillCount
        });
        return output;
      }

      if (!fileName) {
        return {
          ok: false,
          error: "fileName is required when action is 'read'."
        };
      }

      const fullPath = await resolveReadableSkillPath(fileName);
      const content = await readFile(fullPath, "utf8");
      const parsed = parseFrontmatter(content);
      const skillId = fileName.replace(/\/?SKILL\.md$/i, "").replace(/\.md$/i, "");
      const summary = skillSummary(parsed.metadata, skillId);
      let scripts: string[] = [];
      try {
        scripts = await listSkillScriptsById(skillId);
      } catch {
        scripts = [];
      }

      const output = {
        ok: true,
        directory: SKILLS_DIR,
        fileName: basename(fileName),
        fullPath,
        format:
          fullPath.endsWith(`${sep}${DEFAULT_SKILL_FILE}`) || fullPath.endsWith(`/${DEFAULT_SKILL_FILE}`)
            ? "claude-code"
            : "markdown",
        name: summary.name,
        description: summary.description,
        metadata: parsed.metadata,
        scripts,
        frontmatterRaw: parsed.frontmatterRaw,
        contentPreview: truncateText(parsed.body),
        truncated: content.length > MAX_FILE_PREVIEW_CHARS,
        characterCount: content.length
      };
      logToolSuccess("skills_reader", {
        action,
        fileName: output.fileName,
        format: output.format,
        scripts: output.scripts.length
      });
      return output;
    } catch (error) {
      logToolError("skills_reader", error, { action, fileName: fileName ?? null });
      return {
        ok: false,
        directory: SKILLS_DIR,
        error: error instanceof Error ? error.message : "Unknown skills reader error"
      };
    }
  }
});
