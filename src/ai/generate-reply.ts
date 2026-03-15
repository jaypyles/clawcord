import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs } from "ai";
import { resolve } from "node:path";

import { env } from "../config/env";
import { botTools } from "./tools/index";

const provider = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BotReplyResult = {
  text: string;
  toolSummary: string;
};

const MAX_CONVERSATION_MESSAGES = 14;
const MAX_CONVERSATION_CHARS = 12_000;
const MAX_TOOL_SUMMARY_LINES = 8;

function looksLikeActionRequest(prompt: string): boolean {
  const lowered = prompt.toLowerCase();
  return (
    /(download|save|grab|run|execute|convert|fetch|install|open|create|delete|build|fix|debug)\b/.test(
      lowered,
    ) || /https?:\/\//.test(lowered)
  );
}

function trimConversationWindow(
  messages: ConversationMessage[],
): ConversationMessage[] {
  const bounded = messages.slice(-MAX_CONVERSATION_MESSAGES);
  const kept: ConversationMessage[] = [];
  let charCount = 0;

  for (let i = bounded.length - 1; i >= 0; i--) {
    const message = bounded[i];
    if (!message) {
      continue;
    }
    charCount += message.content.length;
    if (charCount > MAX_CONVERSATION_CHARS) {
      break;
    }
    kept.unshift(message);
  }

  return kept.length > 0 ? kept : bounded.slice(-1);
}

function conversationToPrompt(conversation: ConversationMessage[]): string {
  const transcript = conversation
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  return [
    "Conversation context (oldest to newest):",
    transcript,
    "",
    "Respond to the latest USER message while considering prior context.",
  ].join("\n");
}

function summarizeToolResult(result: unknown): {
  outcome: "ok" | "error";
  detail: string;
} {
  if (!result || typeof result !== "object") {
    return { outcome: "ok", detail: "completed" };
  }

  const record = result as Record<string, unknown>;
  const explicitSuccess = record.success;
  const errorText =
    typeof record.error === "string"
      ? record.error
      : typeof record.message === "string"
        ? record.message
        : null;

  if (explicitSuccess === false || errorText) {
    return {
      outcome: "error",
      detail: errorText ?? "failed",
    };
  }

  return { outcome: "ok", detail: "completed" };
}

function formatToolSummary(lines: string[]): string {
  if (lines.length === 0) {
    return "No tools were called.";
  }

  return ["Tool calls from previous turn:", ...lines].join("\n");
}

export async function generateBotReply(
  input: string | ConversationMessage[],
): Promise<BotReplyResult> {
  const conversation: ConversationMessage[] = Array.isArray(input)
    ? trimConversationWindow(input)
    : [{ role: "user", content: input }];
  const latestUserMessage =
    [...conversation].reverse().find((message) => message.role === "user")
      ?.content ?? "";
  const prompt = conversationToPrompt(conversation);
  const actionRequest = looksLikeActionRequest(latestUserMessage);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(
    `[llm:start] request=${requestId} actionRequest=${actionRequest}`,
  );
  console.log(
    `[llm:prompt] request=${requestId} latestUser=${latestUserMessage.slice(0, 300)}`,
  );
  console.log(
    `[llm:context] request=${requestId} messages=${conversation.length} chars=${conversation.reduce((sum, msg) => sum + msg.content.length, 0)}`,
  );

  try {
    const toolSummaryLines: string[] = [];
    const playgroundFolder =
      env.PLAYGROUND_DIR && env.PLAYGROUND_DIR.trim().length > 0
        ? env.PLAYGROUND_DIR
        : resolve(process.cwd(), "playground");

    const agentCoreDir =
      env.AGENT_CORE_DIR && env.AGENT_CORE_DIR.trim().length > 0
        ? env.AGENT_CORE_DIR
        : resolve(process.cwd(), "agent-core");

    const { text, toolCalls } = await generateText({
      model: provider(env.OPENROUTER_MODEL),
      system: `You are a helpful Discord bot. 
        Keep answers concise, clear, and practical unless asked for deep detail. 
        Use tools when they are useful and cite what tool you used in plain language. 

        You have a sandbox folder available to you called 'playground'. 
        Full path: ${playgroundFolder}
        You can do whatever you want in this folder.
        Everything should be performed in this folder unless otherwise specified.

        Everything about your behavior is stored in this folder as md files: ${agentCoreDir}

        MEMORY.md is your memory. Use memory_editor to read/add/delete structured memory entries. ALWAYS check the MEMORY.md file before acting.
        BEHAVIOR.md controls response behavior. Use behavior_editor to read/add/enable-disable/delete structured behavior rules. 
        ALWAYS read BEHAVIOR.md before acting and APPLY all enabled behavior rules to every response (e.g. tone, style, constraints). Your answers must follow those rules.
        You must always read BEHAVIOR.md before responding to any prompt.

        These files are life and death, so should always be read before acting.

        COMMANDS.md is your command registry. Use the commands_registry tool to list/read/upsert commands for quick command workflows.
        SCHEDULE.md defines cron-scheduled prompts. Use schedule_editor to read/add/set_enabled/delete jobs. Each job has a cron expression (e.g. '0 9 * * *' for 9:00 daily) and a prompt; the agent runs that prompt on schedule. Optional discordChannelId posts the reply to a Discord channel.
        User commands come in the form: !<command_name>: whenever a user uses this format, they want to call a command. 
        You should only be reading commands if a user has a command in their message content.

        Before responding to the user, make sure you read these to remember how to respond to things.

        The http_fetch tool accepts rich fetch options similar to native fetch. 
        Use skills_reader to discover and read local skills from ~/.config/clawcord/skills when relevant. 
        Use skills_editor to create, update, or delete skills (action: create/update/delete; skillId + content for create/update). 
        When a user asks you to do an action/task, first call skills_reader with action="list" before other tools. 
        Use the returned skill name + description to choose if a skill applies, and mention the matching skill in your response. 
        Do not claim inability before attempting relevant tool calls. 
        Prefer Claude Code skill format metadata and instructions when available. 
        Use bash_exec for all script and command execution tasks, including Python scripts. 
        For bash_exec filePath mode, do not include inline command unless needed; prioritize filePath + args execution. 
        Before running a skill script with args, inspect SKILL.md details and infer the script's expected CLI style (positional vs named flags). 
        If script execution fails with usage or argument errors, correct flags/args and retry with the same script. 
        If a skill includes scripts for the task, run them via bash_exec filePath mode with appropriate args before answering.`,
      tools: botTools,
      toolChoice: "auto",
      stopWhen: stepCountIs(30),
      onStepFinish: (step) => {
        const calls = (step.toolCalls ?? []).map((toolCall) => {
          const call = toolCall as {
            toolName?: string;
            input?: unknown;
            args?: unknown;
          };
          return {
            toolName: call.toolName ?? "unknown",
            input: call.input ?? call.args ?? null,
          };
        });
        const results = (step.toolResults ?? []).map((result) => {
          const toolResult = result as {
            toolName?: string;
            isError?: boolean;
            error?: unknown;
            result?: unknown;
          };

          const summarized = summarizeToolResult(toolResult.result);
          const toolName = toolResult.toolName ?? "unknown";
          const isError =
            Boolean(toolResult.isError) || summarized.outcome === "error";
          const fallbackError =
            typeof toolResult.error === "string" ? toolResult.error : null;
          const detail = fallbackError ?? summarized.detail;

          toolSummaryLines.push(
            `${isError ? "[error]" : "[ok]"} ${toolName}: ${detail}`,
          );
          return {
            toolName,
            isError,
            error: toolResult.error ?? null,
          };
        });
        console.log(
          `[llm:step] request=${requestId} step=${step.stepNumber} finish=${step.finishReason} toolCalls=${JSON.stringify(calls)} toolResults=${JSON.stringify(results)}`,
        );
        if (calls.length > 0 && results.length === 0) {
          console.warn(
            `[llm:warn] request=${requestId} step=${step.stepNumber} tool call(s) had no results, likely validation or execution mismatch.`,
          );
        }
      },
      prompt,
    });

    if (toolCalls.length > 0 && text.trim().length === 0) {
      console.error(
        `[llm:error] request=${requestId} Tool calls succeeded but no final text.`,
      );
      return {
        text: "I executed tools but could not generate a final answer text.",
        toolSummary: formatToolSummary(
          toolSummaryLines.slice(-MAX_TOOL_SUMMARY_LINES),
        ),
      };
    }

    console.log(
      `[llm:done] request=${requestId} toolCalls=${toolCalls.length} responseChars=${text.length}`,
    );
    return {
      text,
      toolSummary: formatToolSummary(
        toolSummaryLines.slice(-MAX_TOOL_SUMMARY_LINES),
      ),
    };
  } catch (error) {
    console.error(
      `[llm:error] request=${requestId} ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      }`,
    );
    throw error;
  }
}
