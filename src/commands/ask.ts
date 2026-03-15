import { SlashCommandBuilder } from "discord.js";

import { generateBotReply } from "../ai/generate-reply";
import type { SlashCommand } from "../commands";
import { splitIntoDiscordMessages } from "../discord/message-chunks";

export const askCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the LLM a question.")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("What should the model answer?")
        .setRequired(true)
    ),
  async execute(interaction) {
    const prompt = interaction.options.getString("prompt", true);

    await interaction.deferReply();

    try {
      const reply = await generateBotReply(prompt);
      const chunks = splitIntoDiscordMessages(reply.text);
      await interaction.editReply(chunks[0] ?? "");
      for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk) {
          await interaction.followUp(chunk);
        }
      }
    } catch (error) {
      console.error("LLM request failed:", error);
      await interaction.editReply(
        "I could not get a model response right now. Please try again in a moment."
      );
    }
  }
};
