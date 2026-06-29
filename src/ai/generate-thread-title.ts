import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import { env } from "../config/env";
import { getOpenRouterModelChain } from "./model-chain";

const provider = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

const MAX_THREAD_NAME_LENGTH = 100;

export function sanitizeThreadTitle(raw: string): string {
  const title = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ");

  if (title.length <= MAX_THREAD_NAME_LENGTH) {
    return title;
  }

  const truncated = title.slice(0, MAX_THREAD_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > MAX_THREAD_NAME_LENGTH * 0.6) {
    return truncated.slice(0, lastSpace).trimEnd();
  }

  return truncated.trimEnd();
}

export async function generateThreadTitle(
  messageContent: string
): Promise<string | null> {
  const content = messageContent.trim();
  if (!content) {
    return null;
  }

  const modelId = getOpenRouterModelChain()[0];
  if (!modelId) {
    return null;
  }

  try {
    const { text } = await generateText({
      model: provider(modelId),
      maxRetries: 0,
      maxOutputTokens: 40,
      system: `You name Discord conversation threads. Given a user's opening message, output ONLY a short thread title (about 3-8 words). No quotes, no prefix, no explanation. Keep it under ${MAX_THREAD_NAME_LENGTH} characters.`,
      prompt: content.slice(0, 1000),
    });

    const title = sanitizeThreadTitle(text);
    return title.length > 0 ? title : null;
  } catch (error) {
    console.warn(
      "[thread-title] generation failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
