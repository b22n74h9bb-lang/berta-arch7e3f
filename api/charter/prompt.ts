import { assembleChatSystemPrompt } from "@contracts/charter";
import { log } from "../lib/logger";
import { BERTA_SYSTEM } from "./builtin";

export function resolveChatSystemPrompt(charterBody: string | null | undefined): string {
  return assembleChatSystemPrompt({ charterBody, fallback: BERTA_SYSTEM });
}

/** Uses the active charter when one is stored. Storage failures keep the built-in prompt. */
export async function readChatSystemPrompt(
  loadActiveBody: () => Promise<string | null | undefined>,
): Promise<string> {
  try {
    return resolveChatSystemPrompt(await loadActiveBody());
  } catch {
    log.warn("active charter could not be read; using built-in system prompt");
    return BERTA_SYSTEM;
  }
}

export { BERTA_SYSTEM };
