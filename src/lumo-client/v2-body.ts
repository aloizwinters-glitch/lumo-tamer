/**
 * Lumo 2.0 chat/completions request body builder.
 *
 * Mirrors the wire format produced by Proton's web client:
 * ProtonMail/WebClients applications/lumo/src/app/lib/lumo-api-client/core/chat-completions.ts
 * (toChatCompletionsBody / resolveChatModel / buildLumoExtension / serializeMessages).
 *
 * Kept as a small local adapter (rather than syncing the upstream parser, which
 * also carries legacy/tool-delta handling outside this project's scope).
 * Image input follows upstream serializeMessages/toImagePart.
 * Reuses the vendored encryption primitives unchanged; only the packaging differs
 * from the legacy generation_request path.
 */

import { Role, type Turn, type ToolName, type LumoModelTier } from './types.js';
import type { WireImage } from '@lumo/types-api.js';

export type { LumoModelTier };

/** Lumo 2.0 unified endpoint (replaces the legacy `ai/v1/chat`). */
export const LUMO_CHAT_ENDPOINT = 'ai/v1/chat/completions';

/** Which completion is requested; a title is a separate targeted completion. */
export type LumoCompletionTarget = 'message' | 'title';

/** Map a tier to the wire `model` value. `auto` -> `lumo` (Proton routes). */
export function resolveChatModel(tier: LumoModelTier): string {
    switch (tier) {
        case 'lumo-lite':
            return 'lumo-lite';
        case 'lumo-max':
            return 'lumo-max';
        case 'apertus-15':
            return 'apertus-15';
        default:
            return 'lumo';
    }
}

/** Map a Turn role to the chat/completions message role (see serializeMessages). */
function messageRole(role: Role): string {
    switch (role) {
        case Role.ToolResult:
            return 'tool';
        case Role.ToolCall:
            return 'lumo_tool_call';
        default:
            return role; // 'user' | 'assistant' | 'system' are already wire values
    }
}

export interface BuildChatBodyParams {
    /** Turns to send. Already encrypted when `encrypted` is true. */
    turns: Turn[];
    tier: LumoModelTier;
    /** Thinking mode: true -> reasoning_effort:'high', false -> 'none'. */
    enableReasoning: boolean;
    /** Native tool names to enable (e.g. proton_info, web_search). */
    tools?: ToolName[];
    /** Present when U2L encryption is on; folded into the `lumo` extension. */
    encryption?: { requestKeyEncB64: string; requestId: string };
    /** Whether `turns` carry encrypted content (sets message-level `encrypted`). */
    encrypted: boolean;
    /** Completion target; defaults to 'message'. 'title' requests a title. */
    target?: LumoCompletionTarget;
}

/** The `lumo` request extension (auth-independent metadata + encryption keys). */
export interface LumoExtension {
    client_type: 'frontend';
    target?: LumoCompletionTarget;
    request_key?: string;
    request_id?: string;
}

export interface ChatCompletionsTextPart {
    type: 'text';
    text: string;
    encrypted?: true;
}

export interface ChatCompletionsImagePart {
    type: 'image_url';
    image_url: { url: string; encrypted?: true };
}

export type ChatCompletionsContentPart = ChatCompletionsTextPart | ChatCompletionsImagePart;

export interface ChatCompletionsMessage {
    role: string;
    content: string | ChatCompletionsContentPart[];
    encrypted?: true;
}

/**
 * Infer an image's MIME type from the magic bytes at the start of its base64
 * payload (WireImage carries no MIME type). Mirrors upstream; falls back to png.
 */
function inferImageMimeType(base64: string): string {
    if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('R0lGOD')) return 'image/gif';
    if (base64.startsWith('UklGR')) return 'image/webp';
    if (base64.startsWith('Qk')) return 'image/bmp';
    return 'image/png';
}

/**
 * WireImage -> OpenAI `image_url` part. Encrypted payloads are U2L ciphertext,
 * so they use a generic octet-stream MIME plus a sibling `encrypted` flag
 * (same as upstream toImagePart).
 */
function toImagePart(image: WireImage): ChatCompletionsImagePart {
    const mimeType = image.encrypted ? 'application/octet-stream' : inferImageMimeType(image.data);
    return {
        type: 'image_url',
        image_url: {
            url: `data:${mimeType};base64,${image.data}`,
            ...(image.encrypted ? { encrypted: true as const } : {}),
        },
    };
}

/** Serialize one turn; multimodal turns use the content-parts array form. */
function serializeTurn(turn: Turn, encrypted: boolean): ChatCompletionsMessage {
    const role = messageRole(turn.role);
    const images = turn.images ?? [];

    if (images.length === 0) {
        return {
            role,
            content: turn.content ?? '',
            ...(encrypted ? { encrypted: true as const } : {}),
        };
    }

    const parts: ChatCompletionsContentPart[] = [];
    if (turn.content) {
        parts.push({ type: 'text', text: turn.content, ...(encrypted ? { encrypted: true as const } : {}) });
    }
    for (const image of images) {
        parts.push(toImagePart(image));
    }
    // Upstream compat: also flag encryption at the message level for the parts form.
    const anyEncrypted = encrypted || images.some((im) => im.encrypted);
    return { role, content: parts, ...(anyEncrypted ? { encrypted: true as const } : {}) };
}

export interface ChatCompletionsBody {
    model: string;
    messages: ChatCompletionsMessage[];
    stream: true;
    stream_options: { include_usage: true };
    reasoning_effort: 'high' | 'none';
    tools?: Array<{ name: string }>;
    tool_choice?: 'auto';
    lumo: LumoExtension;
}

/** Build the POST body for `ai/v1/chat/completions`. */
export function buildChatCompletionsBody(params: BuildChatBodyParams): ChatCompletionsBody {
    const messages = params.turns.map((turn) => serializeTurn(turn, params.encrypted));

    const lumo: LumoExtension = { client_type: 'frontend' };
    if (params.target) {
        lumo.target = params.target;
    }
    if (params.encryption) {
        lumo.request_key = params.encryption.requestKeyEncB64;
        lumo.request_id = params.encryption.requestId;
    }

    const body: ChatCompletionsBody = {
        model: resolveChatModel(params.tier),
        messages,
        stream: true,
        stream_options: { include_usage: true },
        reasoning_effort: params.enableReasoning ? 'high' : 'none',
        lumo,
    };

    if (params.tools && params.tools.length > 0) {
        body.tools = params.tools.map((name) => ({ name }));
        body.tool_choice = 'auto';
    }

    return body;
}
