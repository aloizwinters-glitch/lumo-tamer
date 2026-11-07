import type { ToolName } from './types.js';

const INTERNAL_TOOLS: ToolName[] = ['proton_info'];
const EXTERNAL_TOOLS: ToolName[] = ['web_search', 'weather', 'stock', 'cryptocurrency'];
/** Same set as the web client's `imageTools` (WebClients lumo-api-client core/client.ts). */
export const IMAGE_TOOLS: ToolName[] = ['generate_image', 'describe_image', 'edit_image'];

/** Native Lumo tools to advertise on the Proton request. */
export function selectNativeTools(options: {
    includeInternal: boolean;
    webSearch: boolean;
    /** Image tools run server-side and mix with client tools, so they don't depend on includeInternal. */
    imageTools?: boolean;
}): ToolName[] {
    return [
        ...(options.includeInternal ? INTERNAL_TOOLS : []),
        ...(options.webSearch ? EXTERNAL_TOOLS : []),
        ...(options.imageTools ? IMAGE_TOOLS : []),
    ];
}
