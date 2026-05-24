import { REST, Routes } from "discord.js";

import { pingCommand } from "./commands/ping";
import { setModelChainCommand } from "./commands/set-model-chain";
import { env } from "./config/env";

const commands = [pingCommand.data.toJSON(), setModelChainCommand.data.toJSON()];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  console.log(`Registering ${commands.length} global commands (guild + DM)...`);
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
    body: commands,
  });

  /** Avoid duplicate slash entries in the dev guild when globals are active. */
  console.log("Clearing guild-scoped commands...");
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body: [] }
  );

  console.log("Global commands registered (may take up to ~1 hour to appear everywhere).");
}

registerCommands().catch((error) => {
  console.error("Failed to register commands:", error);
  process.exit(1);
});
