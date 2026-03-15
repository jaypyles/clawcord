import { readFile } from "node:fs/promises";

import { Cron } from "croner";

import type { Client } from "discord.js";

import { env } from "../config/env";
import { generateBotReply } from "./generate-reply";
import {
  ensureScheduleFile,
  extractJsonlBlock,
  parseJobs,
  SCHEDULE_FILE_PATH,
  type ScheduleJob,
} from "./tools/schedule-editor";

/** Normalize 5-field cron (min hour dom month dow) to 6-field (sec min hour dom month dow) for croner. */
function toCronerPattern(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    return `0 ${cron.trim()}`;
  }
  return cron.trim();
}

async function loadJobs(): Promise<ScheduleJob[]> {
  await ensureScheduleFile();
  const markdown = await readFile(SCHEDULE_FILE_PATH, "utf8");
  const block = extractJsonlBlock(markdown);
  return parseJobs(block.body);
}

const activeCrons: Cron[] = [];
const RELOAD_INTERVAL_MS = 60_000;
let reloadTimer: ReturnType<typeof setInterval> | null = null;
let lastClient: Client | null = null;

/**
 * Start the cron schedule runner. Loads jobs from agent-core/SCHEDULE.md and
 * runs the agent with each job's prompt at the given cron time. If
 * discordChannelId is set, posts the reply to that channel.
 */
function runReload(): void {
  startScheduleRunner(lastClient);
}

export function startScheduleRunner(discordClient: Client | null): void {
  lastClient = discordClient;
  if (reloadTimer) {
    clearInterval(reloadTimer);
    reloadTimer = null;
  }
  loadJobs()
    .then((jobs) => {
      for (const prev of activeCrons) {
        prev.stop();
      }
      activeCrons.length = 0;

      const enabled = jobs.filter((j) => j.enabled);
      for (const job of enabled) {
        try {
          const pattern = toCronerPattern(job.cron);
          const cron = new Cron(pattern, async () => {
            console.log(
              `[schedule] Running job ${job.id}: ${job.prompt.slice(0, 80)}...`,
            );
            try {
              const result = await generateBotReply(job.prompt);
              const channelId =
                job.discordChannelId ?? env.SCHEDULE_DISCORD_CHANNEL_ID;
              if (discordClient && channelId) {
                const channel = await discordClient.channels
                  .fetch(channelId)
                  .catch(() => null);
                if (channel?.isTextBased() && "send" in channel) {
                  const content = result.text.slice(0, 2000);
                  await (
                    channel as { send: (opts: string) => Promise<unknown> }
                  ).send(content);
                }
              } else {
                console.log(
                  `[schedule] job ${job.id} reply: ${result.text.slice(0, 200)}`,
                );
              }
            } catch (err) {
              console.error(`[schedule] job ${job.id} failed:`, err);
            }
          });
          activeCrons.push(cron);
        } catch (err) {
          console.error(
            `[schedule] Invalid cron for job ${job.id} "${job.cron}":`,
            err,
          );
        }
      }
      console.log(
        `[schedule] Loaded ${activeCrons.length} cron job(s) from ${SCHEDULE_FILE_PATH}`,
      );
      reloadTimer = setInterval(runReload, RELOAD_INTERVAL_MS);
    })
    .catch((err) => {
      console.error("[schedule] Failed to load schedule:", err);
    });
}

/**
 * Reload schedule from disk and restart all cron jobs. Call after editing SCHEDULE.md.
 */
export function reloadScheduleRunner(discordClient: Client | null): void {
  startScheduleRunner(discordClient);
}
