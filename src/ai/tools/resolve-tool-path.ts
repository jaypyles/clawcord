import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

function expandUserPath(inputPath: string): string {
  if (inputPath === "~") {
    return homedir();
  }
  if (inputPath.startsWith("~/")) {
    return resolve(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * Resolve a path for file tools: absolute paths as-is, `~` expanded,
 * relative paths from `process.cwd()` (container workdir when running in Docker).
 */
export function resolveToolPath(inputPath: string): string {
  const expanded = expandUserPath(inputPath);
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(process.cwd(), expanded);
}
