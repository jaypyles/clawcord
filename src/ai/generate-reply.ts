import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs } from "ai";
import { resolve } from "node:path";

import { env } from "../config/env";
import { getOpenRouterModelChain } from "./model-chain";
import { botTools } from "./tools/index";
import type { ConversationMessage, BotReplyResult } from "../types/ai";
import {
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATION_MESSAGES,
  MAX_TOOL_SUMMARY_LINES,
} from "../constants/conversation";

export type { ConversationMessage, BotReplyResult };

const provider = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

/** Rotate to the next model on provider errors that may succeed on another route/model. */
function shouldRotateToNextModel(error: unknown): boolean {
  const rotateStatus = new Set([402, 404, 429, "402", "404", "429"]);

  const visit = (node: unknown): boolean => {
    if (node == null || typeof node !== "object") {
      return false;
    }
    const record = node as Record<string, unknown>;
    const status = record.statusCode ?? record.status;
    if (rotateStatus.has(status as number | string)) {
      return true;
    }
    if (typeof record.message === "string") {
      const msg = record.message;
      if (
        /\b402\b/.test(msg) ||
        /\b429\b/.test(msg) ||
        /\b404\b/.test(msg) ||
        /\brate[- ]limit/i.test(msg) ||
        /\btemporarily rate-limited\b/i.test(msg) ||
        /\bno longer available\b/i.test(msg) ||
        /\bnot found\b/i.test(msg) ||
        /\bout of credits\b/i.test(msg) ||
        /\binsufficient_quota\b/i.test(msg)
      ) {
        return true;
      }
    }
    /** AI_RetryError aggregates attempts in `errors` (not always on `cause`). */
    if (Array.isArray(record.errors)) {
      for (const entry of record.errors) {
        if (visit(entry)) {
          return true;
        }
      }
    }
    const lastErr = record.lastError;
    if (lastErr != null && visit(lastErr)) {
      return true;
    }
    if (record.cause != null && visit(record.cause)) {
      return true;
    }
    if (record.response != null && typeof record.response === "object") {
      const response = record.response as Record<string, unknown>;
      if (rotateStatus.has(response.status as number | string)) {
        return true;
      }
    }
    const data = record.data;
    if (data != null && typeof data === "object") {
      const errObj = (data as Record<string, unknown>).error;
      if (errObj != null && typeof errObj === "object") {
        const code = (errObj as Record<string, unknown>).code;
        if (rotateStatus.has(code as number | string)) {
          return true;
        }
      }
    }
    return false;
  };

  return visit(error);
}

function looksLikeActionRequest(prompt: string): boolean {
  const lowered = prompt.toLowerCase();
  return (
    /(download|save|grab|run|execute|convert|fetch|install|open|create|delete|build|fix|debug)\b/.test(
      lowered
    ) || /https?:\/\//.test(lowered)
  );
}

function looksLikeUserCommand(prompt: string): boolean {
  return /![a-zA-Z0-9_-]+/.test(prompt);
}

function buildAgentSystemPrompt(options: {
  playgroundFolder: string;
  agentCoreDir: string;
  actionRequest: boolean;
  hasUserCommand: boolean;
}): string {
  const { playgroundFolder, agentCoreDir, actionRequest, hasUserCommand } =
    options;

  const toolBudget = actionRequest
    ? "Aim for ≤12 tool calls total; stop sooner when the task is done."
    : "Aim for ≤5 tool calls total. Prefer answering after one good source.";

  const skillsGuidance = actionRequest
    ? `For action/task requests: call skills_reader list once, then read a skill only if its description clearly matches. Run skill scripts via bash_exec filePath mode when the skill applies.`
    : `Do not list or read skills for simple questions (menus, facts, lookups). Skills are for multi-step actions (scripts, installs, workflows).`;

  const agentFilesGuidance = actionRequest
    ? `Read BEHAVIOR.md and MEMORY.md once at the start (behavior_editor + memory_editor read). Apply enabled behavior rules.`
    : `Read BEHAVIOR.md once (behavior_editor read) so tone/rules apply. Read MEMORY.md only if the question needs prior context.`;

  return `You are a helpful Discord bot. Keep answers concise, clear, and practical unless asked for deep detail.

## Tool discipline
${toolBudget}
- Call only tools that materially help the latest user message. No speculative browsing.
- Stop as soon as you can answer confidently. Do not chain alternate sites (Yelp, Google, TripAdvisor, etc.) unless the user asked for comparisons or the primary source failed.
- Never invent or guess URLs. Use URLs from the user, search results, or a known official domain.
- Do not repeat the same tool on the same URL in one turn.
- Prefer the fewest steps: for a user-provided page URL, use get_site once (headless browser markdown). Use http_fetch for APIs/JSON only — not as a substitute after get_site already returned markdown.
- When get_site returns success with a \`markdown\` field, answer from that text. Do not claim the page is JS-blocked or unavailable if get_site returned content.
- Do not call http_fetch or get_site again on the same URL after get_site already succeeded with markdownLength > 0.
- Do not use get_site on search engines (Google, DuckDuckGo, Bing) or login-walled aggregators unless the user explicitly asked.
- If a fetch returns little or no useful text, try at most one other authoritative source, then answer with what you have and note gaps.
- Mention which tools you used in plain language when relevant.

## Agent files (${agentCoreDir})
${agentFilesGuidance}
COMMANDS.md: use commands_registry only when the user message contains a command trigger (e.g. !commandname).
SCHEDULE.md: use schedule_editor for cron job changes only when scheduling comes up.
${hasUserCommand ? "This message includes a user command — check COMMANDS.md via commands_registry." : ""}

## Skills
${skillsGuidance}
Use skills_editor only when creating/updating/deleting skills.

## Execution
Sandbox/playground: ${playgroundFolder}
create_file / edit_file / move_file / bash_exec: use for files, scripts, and command execution when needed.
http_fetch: APIs and static JSON only.
get_site: web pages (returns full markdown field — read it to answer).

Answer the latest USER message. Do not claim inability before one reasonable attempt when tools are clearly required.`;
}

function trimConversationWindow(
  messages: ConversationMessage[]
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

const MAX_TOOL_RESULT_DETAIL_CHARS = 800;

function clipToolDetail(text: string): string {
  return text.length > MAX_TOOL_RESULT_DETAIL_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_DETAIL_CHARS)}…`
    : text;
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
  const stderr =
    typeof record.stderr === "string" && record.stderr.trim().length > 0
      ? record.stderr.trim()
      : null;
  const stdout =
    typeof record.stdout === "string" && record.stdout.trim().length > 0
      ? record.stdout.trim()
      : null;

  if (explicitSuccess === false || errorText) {
    const parts: string[] = [errorText ?? "failed"];
    if (stdout) {
      parts.push(`stdout: ${stdout}`);
    }
    if (stderr) {
      parts.push(`stderr: ${stderr}`);
    }
    return {
      outcome: "error",
      detail: clipToolDetail(parts.join(" | ")),
    };
  }

  if (typeof record.markdown === "string" && record.markdown.length > 0) {
    const len =
      typeof record.markdownLength === "number"
        ? record.markdownLength
        : record.markdown.length;
    return {
      outcome: "ok",
      detail: clipToolDetail(`markdown ${len} chars`),
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
  input: string | ConversationMessage[]
): Promise<BotReplyResult> {
  const conversation: ConversationMessage[] = Array.isArray(input)
    ? trimConversationWindow(input)
    : [{ role: "user", content: input }];
  const latestUserMessage =
    [...conversation].reverse().find((message) => message.role === "user")
      ?.content ?? "";
  const prompt = conversationToPrompt(conversation);
  const actionRequest = looksLikeActionRequest(latestUserMessage);
  const hasUserCommand = looksLikeUserCommand(latestUserMessage);
  const maxToolSteps = actionRequest ? 24 : 10;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(
    `[llm:start] request=${requestId} actionRequest=${actionRequest}`
  );
  console.log(
    `[llm:prompt] request=${requestId} latestUser=${latestUserMessage.slice(
      0,
      300
    )}`
  );
  console.log(
    `[llm:context] request=${requestId} messages=${
      conversation.length
    } chars=${conversation.reduce((sum, msg) => sum + msg.content.length, 0)}`
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

    const modelChain = getOpenRouterModelChain();
    console.log(
      `[llm:models] request=${requestId} chain=${modelChain.join(" -> ")}`
    );

    let generation:
      | undefined
      | Awaited<ReturnType<typeof generateText<typeof botTools>>>;

    for (let attempt = 0; attempt < modelChain.length; attempt++) {
      const modelId = modelChain[attempt];
      if (!modelId) {
        throw new Error("OpenRouter model chain produced an empty model id.");
      }
      try {
        generation = await generateText({
          model: provider(modelId),
          /** Avoid burning SDK retries on the same model when we rotate the chain. */
          maxRetries: modelChain.length > 1 ? 0 : undefined,
          system: buildAgentSystemPrompt({
            playgroundFolder,
            agentCoreDir,
            actionRequest,
            hasUserCommand,
          }),
          tools: botTools,
          toolChoice: "auto",
          stopWhen: stepCountIs(maxToolSteps),
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
            /** AI SDK v6 uses `output` on tool-result parts (not `result`). tool-error parts live on `content`, not `toolResults`. */
            type ToolOutcomePart =
              | { type: "tool-result"; toolName: string; output: unknown }
              | { type: "tool-error"; toolName: string; error: unknown };

            const outcomeParts = (step.content ?? []).filter(
              (part) => part.type === "tool-result" || part.type === "tool-error"
            ) as ToolOutcomePart[];

            const results = outcomeParts.map((part) => {
              const toolName =
                typeof part.toolName === "string" ? part.toolName : "unknown";

              if (part.type === "tool-error") {
                const err = part.error;
                const sdkErrorStr =
                  err instanceof Error
                    ? `${err.name}: ${err.message}`
                    : typeof err === "string"
                    ? err
                    : null;
                const detail = sdkErrorStr ?? "tool execution threw";
                toolSummaryLines.push(`[error] ${toolName}: ${detail}`);
                return {
                  toolName,
                  isError: true,
                  sdkError: err ?? null,
                  detail,
                };
              }

              const output = part.output;
              const summarized = summarizeToolResult(output);
              const isError = summarized.outcome === "error";
              const detail = summarized.detail;

              toolSummaryLines.push(
                `${isError ? "[error]" : "[ok]"} ${toolName}: ${detail}`
              );
              return {
                toolName,
                isError,
                sdkError: null,
                detail,
              };
            });
            console.log(
              `[llm:step] request=${requestId} step=${step.stepNumber} finish=${
                step.finishReason
              } toolCalls=${JSON.stringify(calls)} toolResults=${JSON.stringify(
                results
              )}`
            );
            if (calls.length > 0 && results.length === 0) {
              console.warn(
                `[llm:warn] request=${requestId} step=${step.stepNumber} tool call(s) had no tool-result/tool-error parts (schema/unknown tool?).`
              );
            }
          },
          prompt,
        });
        break;
      } catch (error) {
        const hasAnotherModel = attempt < modelChain.length - 1;
        if (shouldRotateToNextModel(error) && hasAnotherModel) {
          const nextModel = modelChain[attempt + 1];
          console.warn(
            `[llm:rotate] request=${requestId} model=${modelId} failed with a retryable provider error; retrying with ${nextModel}`
          );
          continue;
        }
        throw error;
      }
    }

    if (!generation) {
      throw new Error("OpenRouter generation produced no result.");
    }

    const { text, toolCalls } = generation;

    if (toolCalls.length > 0 && text.trim().length === 0) {
      console.error(
        `[llm:error] request=${requestId} Tool calls succeeded but no final text.`
      );
      return {
        text: "I executed tools but could not generate a final answer text.",
        toolSummary: formatToolSummary(
          toolSummaryLines.slice(-MAX_TOOL_SUMMARY_LINES)
        ),
      };
    }

    console.log(
      `[llm:done] request=${requestId} toolCalls=${toolCalls.length} responseChars=${text.length}`
    );
    return {
      text,
      toolSummary: formatToolSummary(
        toolSummaryLines.slice(-MAX_TOOL_SUMMARY_LINES)
      ),
    };
  } catch (error) {
    console.error(
      `[llm:error] request=${requestId} ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      }`
    );
    throw error;
  }
}
