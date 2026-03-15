import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Message,
  Partials
} from "discord.js";

import type { SlashCommand } from "./commands";
import {
  type BotReplyResult,
  type ConversationMessage,
  generateBotReply
} from "./ai/generate-reply";
import { pingCommand } from "./commands/ping";
import { env } from "./config/env";
import { splitIntoDiscordMessages } from "./discord/message-chunks";

type ClientWithCommands = Client & {
  commands: Collection<string, SlashCommand>;
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
}) as ClientWithCommands;

client.commands = new Collection<string, SlashCommand>();
client.commands.set(pingCommand.data.name, pingCommand);

const MAX_REPLY_CHAIN_DEPTH = 20;
const MAX_STORED_TOOL_SUMMARIES = 500;
const toolSummaryByBotMessageId = new Map<string, string>();

async function buildConversationFromMessage(
  message: Message,
  clientUserId: string
): Promise<ConversationMessage[]> {
  const chain: Message[] = [];
  let cursor: Message | null = message;

  for (let depth = 0; depth < MAX_REPLY_CHAIN_DEPTH && cursor; depth++) {
    chain.push(cursor);

    if (!cursor.reference?.messageId) {
      break;
    }

    try {
      cursor = await cursor.channel.messages.fetch(cursor.reference.messageId);
    } catch (error) {
      console.warn("Failed to fetch referenced chain message:", error);
      break;
    }
  }

  const ordered = [...chain].reverse();
  return ordered
    .map((item) => {
      const isBot = item.author.id === clientUserId;
      const content = item.content
        .replace(new RegExp(`<@!?${clientUserId}>`, "g"), "")
        .trim();

      if (!content) {
        return null;
      }

      if (isBot) {
        const toolSummary = toolSummaryByBotMessageId.get(item.id);
        const assistantContent = toolSummary
          ? `${content}\n\n${toolSummary}`
          : content;
        return {
          role: "assistant" as const,
          content: assistantContent
        };
      }

      return {
        role: "user" as const,
        content: `${item.author.username}: ${content}`
      };
    })
    .filter((turn): turn is ConversationMessage => Boolean(turn));
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({
      content: "Unknown command.",
      ephemeral: true
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command "${interaction.commandName}" failed:`, error);
    const errorResponse = {
      content: "There was an error while running this command.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorResponse);
    } else {
      await interaction.reply(errorResponse);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !client.user) {
    return;
  }

  const isDm = message.guildId === null;
  const mentionsBot = message.mentions.users.has(client.user.id);
  const isReply = Boolean(message.reference?.messageId);
  let replyingToBot = false;

  if (isReply && message.reference?.messageId) {
    try {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      replyingToBot = referenced.author.id === client.user.id;
    } catch (error) {
      console.warn("Failed to resolve reply target:", error);
    }
  }

  if (!isDm && !mentionsBot && !replyingToBot) {
    return;
  }

  const conversation = await buildConversationFromMessage(message, client.user.id);

  if (conversation.length === 0) {
    await message.reply(
      isDm
        ? "Send me a message with your prompt."
        : "Mention me with a prompt, for example: `@bot summarize this link ...`"
    );
    return;
  }

  await message.channel.sendTyping();

  try {
    const reply: BotReplyResult = await generateBotReply(conversation);
    const chunks = splitIntoDiscordMessages(reply.text);
    const sentMessage = await message.reply(chunks[0] ?? "");
    toolSummaryByBotMessageId.set(sentMessage.id, reply.toolSummary);
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk) {
        // Store the same summary for all bot chunks in this turn.
        // This preserves tool-memory continuity even if user replies to a later chunk.
        const sentChunk = await message.channel.send(chunk);
        toolSummaryByBotMessageId.set(sentChunk.id, reply.toolSummary);
      }
    }

    if (toolSummaryByBotMessageId.size > MAX_STORED_TOOL_SUMMARIES) {
      const oldestKey = toolSummaryByBotMessageId.keys().next().value;
      if (oldestKey) {
        toolSummaryByBotMessageId.delete(oldestKey);
      }
    }
  } catch (error) {
    console.error("Mention request failed:", error);
    await message.reply(
      "I could not get a model response right now. Please try again in a moment."
    );
  }
});

client.login(env.DISCORD_TOKEN).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
