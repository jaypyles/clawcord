import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  /** Comma-separated OpenRouter model ids tried in order when rate-limited (429). */
  OPENROUTER_FREE_MODELS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value?.trim()) {
        return [] as string[];
      }
      return value
        .split(",")
        .map((model) => model.trim())
        .filter((model) => model.length > 0);
    }),
  /** Used after all OPENROUTER_FREE_MODELS return 429 for the same request. */
  OPENROUTER_PAID_MODEL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : undefined;
    }),
  PLAYGROUND_DIR: z.string().optional(),
  AGENT_CORE_DIR: z.string().optional(),
  SCHEDULE_DISCORD_CHANNEL_ID: z
    .string()
    .optional()
    .describe("Default Discord channel ID for scheduled job replies when job has no discordChannelId"),
  ENABLE_BASH_TOOL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Per bash_exec spawned process timeout (ms). Default 120s; increase for slow API scripts. */
  BASH_EXEC_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value?.trim()) {
        return 120_000;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1000) {
        return 120_000;
      }
      return Math.min(Math.floor(n), 600_000);
    }),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
