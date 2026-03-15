import { SlashCommandBuilder } from "discord.js";

import type { SlashCommand } from "../commands";

export const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online."),
  async execute(interaction) {
    await interaction.reply("Pong.");
  }
};
