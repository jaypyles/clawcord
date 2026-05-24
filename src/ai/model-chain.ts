import { DEFAULT_MODEL_CHAIN } from "../constants/model-chain";

let modelChainOverride: string[] | null = null;

export function parseModelChain(value: string): string[] {
  return value
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

export function setModelChainOverride(chain: string[] | null): void {
  modelChainOverride = chain?.length ? [...chain] : null;
}

export function getModelChainOverride(): string[] | null {
  return modelChainOverride ? [...modelChainOverride] : null;
}

/** Runtime override from `/set-model-chain`, otherwise `DEFAULT_MODEL_CHAIN` from env. */
export function getOpenRouterModelChain(): string[] {
  if (modelChainOverride?.length) {
    return [...modelChainOverride];
  }
  return [...DEFAULT_MODEL_CHAIN];
}
