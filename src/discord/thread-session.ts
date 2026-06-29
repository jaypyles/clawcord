import {
  Message,
  ThreadAutoArchiveDuration,
  type ThreadChannel,
} from "discord.js";

import type { BotReplyResult } from "../ai/generate-reply";
import {
  generateThreadTitle,
  sanitizeThreadTitle,
} from "../ai/generate-thread-title";
import type { ConversationMessage } from "../types/ai";
import { splitIntoDiscordMessages } from "./message-chunks";

const MAX_THREAD_MESSAGES = 50;
const MAX_STORED_TOOL_SUMMARIES = 500;

type ReplyChannel = {
  send: (content: string) => Promise<Message>;
  sendTyping?: () => Promise<unknown>;
};

export type { ReplyChannel };

const agentThreadIds = new Set<string>();
const toolSummaryByBotMessageId = new Map<string, string>();
const MAX_THREAD_NAME_LENGTH = 100;

function extractMessageContent(message: Message, clientUserId: string): string {
  return message.content
    .replace(new RegExp(`<@!?${clientUserId}>`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackThreadName(message: Message, clientUserId: string): string {
  const content = extractMessageContent(message, clientUserId);
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";

  if (firstLine.length > 0) {
    return sanitizeThreadTitle(firstLine);
  }

  const fallback = `agent-${message.author.username}`;
  return fallback.length > MAX_THREAD_NAME_LENGTH
    ? fallback.slice(0, MAX_THREAD_NAME_LENGTH)
    : fallback;
}

async function setGeneratedThreadName(
  thread: ThreadChannel,
  message: Message,
  clientUserId: string
): Promise<void> {
  const title = await generateThreadTitle(
    extractMessageContent(message, clientUserId)
  );
  if (!title || title === thread.name) {
    return;
  }

  try {
    await thread.setName(title);
    console.log(`[thread] renamed id=${thread.id} name=${title}`);
  } catch (error) {
    console.warn(
      `[thread] failed to rename id=${thread.id}:`,
      error instanceof Error ? error.message : error
    );
  }
}

function messageToTurn(
  item: Message,
  clientUserId: string
): ConversationMessage | null {
  const content = item.content
    .replace(new RegExp(`<@!?${clientUserId}>`, "g"), "")
    .trim();

  if (!content) {
    return null;
  }

  if (item.author.id === clientUserId) {
    const toolSummary = toolSummaryByBotMessageId.get(item.id);
    const assistantContent = toolSummary
      ? `${content}\n\n${toolSummary}`
      : content;
    return { role: "assistant", content: assistantContent };
  }

  return {
    role: "user",
    content: `${item.author.username}: ${content}`,
  };
}

export async function buildConversationFromThread(
  thread: ThreadChannel,
  clientUserId: string
): Promise<ConversationMessage[]> {
  const turns: ConversationMessage[] = [];
  const starter = await thread.fetchStarterMessage().catch(() => null);

  if (starter && !starter.author.bot) {
    const turn = messageToTurn(starter, clientUserId);
    if (turn) {
      turns.push(turn);
    }
  }

  const messages = await thread.messages.fetch({ limit: MAX_THREAD_MESSAGES });
  const ordered = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  for (const message of ordered) {
    if (starter && message.id === starter.id) {
      continue;
    }
    const turn = messageToTurn(message, clientUserId);
    if (turn) {
      turns.push(turn);
    }
  }

  return turns;
}

export function messageToConversationTurn(
  message: Message,
  clientUserId: string
): ConversationMessage | null {
  return messageToTurn(message, clientUserId);
}

export async function isAgentThread(
  thread: ThreadChannel,
  clientUserId: string
): Promise<boolean> {
  if (agentThreadIds.has(thread.id)) {
    return true;
  }

  const recent = await thread.messages.fetch({ limit: 20 });
  const botParticipated = [...recent.values()].some(
    (message) => message.author.id === clientUserId
  );
  if (botParticipated) {
    agentThreadIds.add(thread.id);
  }
  return botParticipated;
}

export async function startAgentThread(
  message: Message,
  clientUserId: string
): Promise<ThreadChannel> {
  const fullMessage = message.partial ? await message.fetch() : message;
  const channel = fullMessage.channel;

  if (!channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Cannot create a thread in this channel type.");
  }

  if (!("threads" in channel) || !channel.threads) {
    throw new Error("This channel does not support threads.");
  }

  const thread = await channel.threads.create({
    name: fallbackThreadName(fullMessage, clientUserId),
    startMessage: fullMessage.id,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: "Agent session",
  });

  await thread.join().catch((error) => {
    console.warn("Failed to join agent thread:", error);
  });

  agentThreadIds.add(thread.id);
  console.log(
    `[thread] created id=${thread.id} name=${thread.name} parent=${channel.id}`
  );
  void setGeneratedThreadName(thread, fullMessage, clientUserId);
  return thread;
}

function trimToolSummaryCache(): void {
  if (toolSummaryByBotMessageId.size <= MAX_STORED_TOOL_SUMMARIES) {
    return;
  }
  const oldestKey = toolSummaryByBotMessageId.keys().next().value;
  if (oldestKey) {
    toolSummaryByBotMessageId.delete(oldestKey);
  }
}

export async function sendBotReply(
  channel: ReplyChannel,
  reply: BotReplyResult
): Promise<void> {
  const chunks = splitIntoDiscordMessages(reply.text).filter(
    (chunk, index, all) => index === 0 || chunk !== all[index - 1]
  );
  console.log(`[message] sending chunks=${chunks.length} chars=${reply.text.length}`);

  if (chunks.length === 0) {
    return;
  }

  const sentMessage = await channel.send(chunks[0] ?? "");
  toolSummaryByBotMessageId.set(sentMessage.id, reply.toolSummary);

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk) {
      const sentChunk = await channel.send(chunk);
      toolSummaryByBotMessageId.set(sentChunk.id, reply.toolSummary);
    }
  }

  trimToolSummaryCache();
}
