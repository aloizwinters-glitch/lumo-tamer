/**
 * Pure append/dedup helpers shared by both ConversationStore backends.
 *
 * Persistence differs (Redux+IndexedDB vs in-memory LRU); the append
 * math — continuation validation, dedup, semantic ids, titles — does not.
 */

import { Role } from "@lumo/types.js";
import { logger } from "../app/logger.js";
import { getMetrics } from "../app/metrics.js";
import {
  findNewMessages,
  hashMessage,
  isValidContinuation,
} from "./deduplication.js";
import type { ConversationId, Message, MessageForStore } from "./types.js";
import type { Turn } from "../lumo-client/types.js";

/** Title from the first user turn, else a timestamp fallback. */
export function generateAutoTitle(turns: Turn[]): string {
  const firstUserTurn = turns.find((t) => t.role === Role.User);
  if (firstUserTurn?.content) {
    const content = firstUserTurn.content.trim();
    return content.length > 50 ? content.slice(0, 47) + "..." : content;
  }
  const timestamp = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `Chat (${timestamp})`;
}

/** Trimmed save title, auto-generated from turns when absent. */
export function effectiveSaveTitle(turns: Turn[], title?: string): string {
  return title?.trim().substring(0, 100) || generateAutoTitle(turns);
}

/** semanticId from a provided id (tool messages) or a role+content hash. */
export function semanticIdFor(
  role: Role,
  content: string | undefined,
  providedId?: string,
): string {
  return providedId ?? hashMessage(role, content ?? "").slice(0, 16);
}

/** Parent of a new message: the last stored message, if any. */
export function lastMessageId(messages: Message[]): string | undefined {
  return messages[messages.length - 1]?.id;
}

/** Tool-call payloads persist as function_call JSON in assistant turns. */
export function serializeToolCall(tc: {
  call_id: string;
  name: string;
  arguments: string;
}): string {
  return JSON.stringify({
    type: "function_call",
    call_id: tc.call_id,
    name: tc.name,
    arguments: tc.arguments,
  });
}

/** Continuation validation + dedup. Returns [] when nothing is new. */
export function findAppendableMessages(
  id: ConversationId,
  incoming: MessageForStore[],
  stored: Message[],
): MessageForStore[] {
  const validation = isValidContinuation(incoming, stored);
  if (!validation.valid) {
    getMetrics()?.invalidContinuationsTotal.inc();
    logger.warn(
      {
        conversationId: id,
        reason: validation.reason,
        incomingCount: incoming.length,
        storedCount: stored.length,
        ...validation.debugInfo,
      },
      "Invalid conversation continuation",
    );
    // Continue anyway; the log keeps the mismatch visible.
  }

  const newMessages = findNewMessages(incoming, stored);
  if (newMessages.length === 0) {
    logger.debug({ conversationId: id }, "No new messages to append");
  }
  return newMessages;
}

/** Messages as Lumo turns. */
export function turnsFromMessages(messages: Message[]): Turn[] {
  return messages.map(({ role, content }) => ({
    role,
    content: content ?? "",
  }));
}
