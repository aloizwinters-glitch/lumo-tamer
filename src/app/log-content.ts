/**
 * Conversation content in logs (prompts, replies, tool arguments, search
 * queries, tool results) only when log.messageContent is true. Otherwise only
 * its length is logged, so logs, log files and the /logs page stay free of
 * what the user and Lumo said.
 */

import { getLogConfig } from "./config.js";

export function logsMessageContent(): boolean {
  try {
    return getLogConfig().messageContent === true;
  } catch {
    return false;
  }
}

/** Clipped content when allowed, else a length placeholder. */
export function contentForLog(value: unknown, max = 200): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  if (!logsMessageContent()) return `[hidden: ${text.length} chars]`;
  const flat = text.replace(/\n/g, "\\n");
  return flat.length > max ? `${flat.substring(0, max)}...` : flat;
}
