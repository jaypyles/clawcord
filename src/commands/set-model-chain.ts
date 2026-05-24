import { SlashCommandBuilder } from "discord.js";

import { getOpenRouterModelChain, parseModelChain, setModelChainOverride } from "../ai/model-chain";
import type { SlashCommand } from "../commands";

export const setModelChainCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("set-model-chain")
    .setDescription("Set the LLM model chain for this bot session.")
    .addStringOption((option) =>
      option
        .setName("model-chain")
        .setDescription("Comma-separated list of models from OpenRouter.")
        .setRequired(true)
    ),
  async execute(interaction) {
    const raw = interaction.options.getString("model-chain", true);
    const chain = parseModelChain(raw);

    if (chain.length === 0) {
      await interaction.reply({
        content: "Provide at least one model id (comma-separated OpenRouter model names).",
        ephemeral: true,
      });
      return;
    }

    setModelChainOverride(chain);
    await interaction.reply(
      `Model chain updated for this session:\n\`${getOpenRouterModelChain().join(" -> ")}\``
    );
  },
};
