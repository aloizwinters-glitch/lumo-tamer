/**
 * Web-search tool gating for agent requests.
 *
 * Agent clients (OpenCode) send one request per tool-loop step under a large system
 * prompt. With web_search / weather / stock / cryptocurrency advertised on all of them,
 * Lumo fires off-topic searches in the middle of coding work (e.g. while restarting a
 * server resource) until its search budget runs out. In agent mode these tools are
 * therefore only offered when the last real user message asks for something online.
 */

import type { Turn } from './types.js';
import { latestUserRequestText } from './images.js';

const w = (list: string[]) => '(?<!\\p{L})(?:' + list.join('|') + ')(?!\\p{L})';

const WEB_INTENT_RE = new RegExp(w([
    // Explicit web search ("web"/"online"/"stock"/"crypto" alone are too common in code)
    'sur\\s+(?:le\\s+)?(?:web|net|internet)', 'on\\s+the\\s+(?:web|internet)', 'internet', 'en\\s+ligne',
    'recherche\\s+web', 'web\\s+search', 'google\\p{L}*', 'bing', 'duckduckgo',
    'search\\s+(?:the\\s+web|online)', 'look\\s+(?:it\\s+)?up\\s+online',
    'busca\\p{L}*\\s+en\\s+(?:internet|la\\s+web)', 'im\\s+internet', 'cerca\\s+(?:online|su\\s+internet)',
    // Current events / freshness
    'actualit[ée]s?', 'news', 'latest\\s+(?:version|release|news)',
    'derni[èe]re?s?\\s+(?:version|release|mise\\s+[àa]\\s+jour|actu\\p{L}*|nouvelles)',
    // Weather / markets
    'm[ée]t[ée]o', 'weather', 'wetter',
    'bourse', 'stock\\s+(?:price|market)', 'cours\\s+de\\s+(?:l[\'’]action|bourse)', 'share\\s+price',
    'bitcoin', 'ethereum', 'cryptomonnaies?', 'cryptocurrenc\\p{L}*',
]), 'iu');

/** True if the last real user message asks for online / current information. */
export function asksForWeb(turns: Turn[], instructions?: string): boolean {
    const text = latestUserRequestText(turns, instructions);
    return text !== null && WEB_INTENT_RE.test(text);
}
