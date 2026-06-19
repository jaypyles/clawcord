import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Message,
  Partials
} from "discord.js";

import type { SlashCommand } from "./commands";
import { generateBotReply } from "./ai/generate-reply";
import { startScheduleRunner } from "./ai/schedule-runner";
import { pingCommand } from "./commands/ping";
import { setModelChainCommand } from "./commands/set-model-chain";
import { env } from "./config/env";
import {
  buildConversationFromThread,
  isAgentThread,
  messageToConversationTurn,
  sendBotReply,
  startAgentThread
} from "./discord/thread-session";
import type { ConversationMessage } from "./types/ai";
import type { ReplyChannel } from "./discord/thread-session";

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
client.commands.set(setModelChainCommand.data.name, setModelChainCommand);

const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const messagesInFlight = new Set<string>();
const recentlyHandledMessageIds = new Map<string, number>();
const MESSAGE_DEDUP_MS = 60_000;

function claimMessage(message: Message): boolean {
  if (message.partial) {
    return false;
  }
  if (messagesInFlight.has(message.id)) {
    return false;
  }

  const lastHandledAt = recentlyHandledMessageIds.get(message.id);
  if (
    lastHandledAt !== undefined &&
    Date.now() - lastHandledAt < MESSAGE_DEDUP_MS
  ) {
    return false;
  }

  messagesInFlight.add(message.id);
  return true;
}

function releaseMessage(messageId: string, handled: boolean): void {
  messagesInFlight.delete(messageId);
  if (handled) {
    recentlyHandledMessageIds.set(messageId, Date.now());
    if (recentlyHandledMessageIds.size > 500) {
      const now = Date.now();
      for (const [id, handledAt] of recentlyHandledMessageIds) {
        if (now - handledAt > MESSAGE_DEDUP_MS) {
          recentlyHandledMessageIds.delete(id);
        }
      }
    }
  }
}

async function handleConversation(
  message: Message,
  conversation: ConversationMessage[],
  replyChannel: ReplyChannel
): Promise<void> {
  if (conversation.length === 0) {
    await replyChannel.send(
      message.guildId === null
        ? "Send me a message with your prompt."
        : "Mention me with a prompt, for example: `@bot summarize this link ...`"
    );
    return;
  }

  if (replyChannel.sendTyping) {
    await replyChannel.sendTyping();
  }

  try {
    const reply = await generateBotReply(conversation);
    await sendBotReply(replyChannel, reply);
  } catch (error) {
    console.error("Agent request failed:", error);
    await replyChannel.send(
      "I could not get a model response right now. Please try again in a moment."
    );
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag} (instance=${instanceId})`);
  console.log(
    "[bot] Duplicate replies? Ensure only ONE process uses this token (stop Docker before bun dev)."
  );
  startScheduleRunner(readyClient);
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
  if (message.author.bot || !client.user || !claimMessage(message)) {
    return;
  }

  const clientUserId = client.user.id;
  const isDm = message.guildId === null;
  const mentionsBot = message.mentions.users.has(clientUserId);
  let handled = false;

  try {
    console.log(
      `[message] handling id=${message.id} instance=${instanceId} dm=${isDm} channel=${message.channel.id}`
    );

    if (isDm) {
      const turn = messageToConversationTurn(message, clientUserId);
      const conversation = turn ? [turn] : [];
      await handleConversation(message, conversation, message.channel);
      handled = true;
      return;
    }

    if (message.channel.isThread()) {
      if (!(await isAgentThread(message.channel, clientUserId))) {
        return;
      }
      const conversation = await buildConversationFromThread(
        message.channel,
        clientUserId
      );
      await handleConversation(message, conversation, message.channel);
      handled = true;
      return;
    }

    if (!mentionsBot) {
      return;
    }

    if (!message.channel.isTextBased() || message.channel.isDMBased()) {
      return;
    }

    const thread = await startAgentThread(message);
    const conversation = await buildConversationFromThread(thread, clientUserId);
    await handleConversation(message, conversation, thread);
    handled = true;
  } catch (error) {
    console.error("Message handler failed:", error);
    if (
      message.channel.isTextBased() &&
      !message.channel.isDMBased() &&
      mentionsBot
    ) {
      await message
        .reply(
          "I could not start a thread here. Check that I have **Create Public Threads** and **Send Messages in Threads** permissions, then try again."
        )
        .catch((replyError) => {
          console.error("Failed to send thread error reply:", replyError);
        });
      handled = true;
    }
  } finally {
    releaseMessage(message.id, handled);
  }
});

client.login(env.DISCORD_TOKEN).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
