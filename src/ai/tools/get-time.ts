import { tool } from "ai";
import { z } from "zod";

export const getTimeTool = tool({
  description: "Get the current UTC timestamp.",
  inputSchema: z.object({}),
  execute: async () => ({
    isoUtc: new Date().toISOString()
  })
});
