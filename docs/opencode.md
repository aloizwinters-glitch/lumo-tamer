# OpenCode configuration

Use **`lumo-max`** for coding (GLM). Thinking is on by default for that model. Keep `server.customTools.enabled: true` (the default) so OpenCode tools are forwarded.

`build` / `plan` use lumo-max. Isolated jobs can use OpenCode `task` (`lite` / `explore` / `general`). A short reply that ends with a colon and no tool JSON is bounced once (`forAnnounceBounce`).

Lumo's window is **128.0K tokens** (the in-app meter). Integer form: `limit.context` **131072**, `limit.output` **13107** (12.8K reserved to keep chatting). The proxy does not expose that meter; without these limits OpenCode auto-compaction never runs. Details: [README: Context window](../README.md#context-window).

The default `server.models.allowedModels` are `lumo`, `lumo-lite`, `lumo-max`, and `apertus-15` (Apertus 1.5). With `server.reasoning.autoVariants: true` (the default), `/v1/models` additionally advertises a pinned `-thinking` variant for each (`lumo-thinking`, `lumo-max-thinking`, …) — each one thinks even when a client sends `reasoning_effort: "none"`, which is exactly what OpenCode's per-model thinking toggle sends. Aliases: `apertus` / `apertus-1.5` → `apertus-15`.

Add Lumo to `provider` in your OpenCode `opencode.json` / `opencode.jsonc`:

```json
{
  "provider": {
    "lumo-tamer": {
      "models": {
        "lumo": {
          "name": "Lumo",
          "limit": { "context": 131072, "output": 13107 },
          "attachment": true,
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "lumo-lite": {
          "name": "lumo-lite",
          "limit": { "context": 131072, "output": 13107 },
          "attachment": true,
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "lumo-max": {
          "name": "lumo-max",
          "limit": { "context": 131072, "output": 13107 },
          "attachment": true,
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "apertus-15": {
          "name": "Apertus 1.5",
          "limit": { "context": 131072, "output": 13107 }
        },
        "lumo-max-thinking": {
          "name": "lumo-max (always thinking)",
          "limit": { "context": 131072, "output": 13107 },
          "attachment": true,
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        }
      },
      "name": "Lumo (local)",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:3003/v1",
        "apiKey": "your-super-secret-key"
      }
    }
  }
}
```

**Images (vision):** to let OpenCode attach images/screenshots, add `"attachment": true` and `"modalities": { "input": ["text", "image"], "output": ["text"] }` to each Lumo model, `server.bodyLimit` (default `"10mb"`) covers the base64-encoded images out of the box. See [README: Images](../README.md#images) for inbound vision and outbound generation. Images are U2L-encrypted before they leave the proxy. To let Lumo create and edit images, set `server.enableImageTools: true`; generated images come back as markdown data-URL images in the reply, and asking to change "the previous image" makes Lumo call `edit_image` on it.

The proxy reports `context_window` (131072) and `max_tokens` (13107) in each `/v1/models` entry, but keep the explicit `limit` block — OpenCode does not reliably auto-discover them. `reasoning_effort` accepts `none / minimal / low / medium / high / xhigh / default` (`minimal` and `xhigh` are OpenCode-compat aliases); your `server.reasoning.default` applies when the request sends none or `default`.
