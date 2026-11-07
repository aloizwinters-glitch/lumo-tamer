/**
 * Image input support (vision).
 *
 * Mirrors Proton's web client:
 * - WebClients packages/lumo-api-client/core/encryption.ts (encryptImage): image bytes are
 *   AES-GCM encrypted with the same per-request key and request AD as the turn text,
 *   so images get the same U2L protection as message content.
 * - WebClients applications/lumo/src/app/llm/attachments.ts: supported MIME types and
 *   the "only the most recent N images per request" rule.
 *
 * Kept local (instead of editing the vendored encryption.ts) so a future upstream
 * sync of packages/lumo can replace it without patch conflicts.
 */

import { v4 as uuidv4 } from 'uuid';
import type { WireImage } from '@lumo/types-api.js';
import type { RequestEncryptionParams } from '@lumo/lib/lumo-api-client/core/encryptionParams.js';
import type { Turn } from './types.js';

/** Upstream MAX_IMAGES_PER_REQUEST: older images beyond this are dropped. */
export const MAX_IMAGES_PER_REQUEST = 10;

/** MIME types accepted by the Lumo web client for image attachments. */
export const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const DATA_URL_RE = /^data:([^;,]+)((?:;[^;,]+)*?);base64,(.*)$/s;

export type ParsedImage =
    | { ok: true; image: WireImage; mimeType: string }
    | { ok: false; reason: string };

/**
 * Parse an OpenAI image reference (`data:image/...;base64,...`) into a plaintext WireImage.
 * Remote http(s) URLs are rejected on purpose: fetching arbitrary URLs from the proxy
 * would be an SSRF vector, and OpenAI-compatible clients (OpenCode, etc.) send data URLs.
 */
export function parseImageUrl(url: unknown): ParsedImage {
    if (typeof url !== 'string' || url.length === 0) {
        return { ok: false, reason: 'missing image url' };
    }
    const match = DATA_URL_RE.exec(url);
    if (!match) {
        return { ok: false, reason: 'only base64 data: URLs are supported for images' };
    }
    const mimeType = match[1].toLowerCase();
    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
        return { ok: false, reason: `unsupported image type ${mimeType}` };
    }
    const data = match[3].replace(/\s+/g, '');
    if (!data) {
        return { ok: false, reason: 'empty image data' };
    }
    return { ok: true, mimeType, image: { encrypted: false, image_id: uuidv4(), data } };
}

/**
 * Keep only the most recent `max` images across the conversation (upstream rule).
 * Older images are dropped; text is untouched.
 */
export function limitImages<T extends Turn>(turns: T[], max = MAX_IMAGES_PER_REQUEST): T[] {
    let budget = max;
    const result = new Array<T>(turns.length);
    for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (!turn.images || turn.images.length === 0) {
            result[i] = turn;
            continue;
        }
        const keep = budget > 0 ? turn.images.slice(-budget) : [];
        budget -= keep.length;
        if (keep.length === turn.images.length) {
            result[i] = turn;
        } else {
            const { images: _dropped, ...rest } = turn;
            result[i] = (keep.length > 0 ? { ...rest, images: keep } : rest) as T;
        }
    }
    return result;
}

/** Remove images from all turns (e.g. for title generation, which only needs text). */
export function stripImages(turns: Turn[]): Turn[] {
    return turns.map((turn) => {
        if (!turn.images) return turn;
        const { images: _images, ...rest } = turn;
        return rest;
    });
}

export function countImages(turns: Turn[]): number {
    return turns.reduce((n, t) => n + (t.images?.length ?? 0), 0);
}

/** Base64 -> bytes (Node Buffer, no atob dependency). */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const buf = Buffer.from(base64, 'base64');
    const out = new Uint8Array(new ArrayBuffer(buf.length));
    out.set(buf);
    return out;
}

/** Encrypt one image with the request key + request AD (upstream encryptImage). */
async function encryptImage(image: WireImage, encryption: RequestEncryptionParams): Promise<WireImage> {
    if (image.encrypted) return image;
    const encryptedData = await encryption.encryptUint8Array(base64ToBytes(image.data));
    return { ...image, data: encryptedData, encrypted: true };
}

/**
 * Encrypt the images of turns whose text has already been U2L-encrypted.
 * The vendored encryptTurns() only encrypts `content`; this completes it so no
 * plaintext image ever leaves the proxy when encryption is enabled.
 */
export async function encryptTurnImages<T extends Turn>(turns: T[], encryption: RequestEncryptionParams): Promise<T[]> {
    return Promise.all(
        turns.map(async (turn) => {
            if (!turn.images || turn.images.length === 0) return turn;
            const images = await Promise.all(turn.images.map((im) => encryptImage(im, encryption)));
            return { ...turn, images };
        }),
    );
}

/** Safety net: true if any image would be sent in plaintext. */
export function hasPlaintextImages(turns: Turn[]): boolean {
    return turns.some((t) => t.images?.some((im) => !im.encrypted) ?? false);
}
