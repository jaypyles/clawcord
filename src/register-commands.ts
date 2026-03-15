import { REST, Routes } from "discord.js";

import { pingCommand } from "./commands/ping";
import { env } from "./config/env";

const commands = [pingCommand.data.toJSON()];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  console.log(`Registering ${commands.length} guild commands...`);

  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    {
      body: commands
    }
  );

  console.log("Guild commands registered.");
}

registerCommands().catch((error) => {
  console.error("Failed to register commands:", error);
  process.exit(1);
});
