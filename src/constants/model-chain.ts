import { env } from "../config/env";

function modelChainFromEnv(): string[] {
  const free = env.OPENROUTER_FREE_MODELS;
  if (free.length > 0) {
    const chain = [...free];
    if (env.OPENROUTER_PAID_MODEL) {
      chain.push(env.OPENROUTER_PAID_MODEL);
    }
    return chain;
  }
  return [env.OPENROUTER_MODEL];
}

/** OpenRouter model chain from process env at startup (`OPENROUTER_FREE_MODELS`, `OPENROUTER_PAID_MODEL`, or `OPENROUTER_MODEL`). */
export const DEFAULT_MODEL_CHAIN: readonly string[] = modelChainFromEnv();
