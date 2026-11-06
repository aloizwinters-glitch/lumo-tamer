# Custom Tools (API)

This document covers custom tool integration for API clients (e.g., Home Assistant, Open WebUI, OpenCode).

For CLI local actions (file operations, code execution), see [local-actions.md](local-actions.md).

---

## How the proxy works

The contract with Lumo: a custom tool is **text** — one JSON object, preferably in a ` ```json ` fence, name prefixed by `customTools.prefix`. Bounce is the same: if Lumo uses its native pipeline (or only announces an action in prose), ask it to emit that JSON again.

1. **In** — `tools[]`, `tool_calls`, `function_call_output` cannot go to Proton (400). Flatten them: past calls become the same fenced JSON Lumo is told to emit; results become `[Tool Result: name]`.
2. **Out** — locate a fence or a raw `{ "name":` blob, then extract `{name, arguments}` (strict JSON, jammed objects, then lenient strings). Prefix stripped for the client.

If a call is not executed, the log says `[tools] not executed` and why.

## Warning

Custom tool support is experimental. Tool calls can fail because of:

- **Too many tools**: Lumo gets confused when the client provides many tools or (very) long instructions.
- **Misrouted calls**: Lumo routes custom tools through its native pipeline, which fails server-side. lumo-tamer bounces these back, but this adds latency and isn't always reliable.
- **Only-announced calls**: Lumo narrates an action ("I would edit the file...") without emitting the JSON block. The `recovery` bounces cover this.
- **Wrong tool/arguments**: Lumo sets the wrong tool name or arguments.
- **Detection failures**: JSON code blocks or mid-line `{"name":…}` objects are not properly detected or parsed. Example JSON that names a tool not in the request is left as text.

This requires trial and error. Experiment with `server.instructions` settings to improve results.

**Privacy note**: When Lumo misroutes a tool call, the tool name and arguments are sent to Proton's servers via the native tool pipeline. This data may be processed unencrypted server-side and could appear in Proton's logs. If your tools handle sensitive data, be aware of this risk. Tool results are not affected: they flow through the normal message pipeline with encryption.

---

## Quick Start

1. Client `tools[]` are on by default (`customTools.enabled: true`). Turn that off only if you want to ignore client tools.
2. Configure your API client (Home Assistant, Open WebUI, etc.) to use tools as normal.
3. lumo-tamer intercepts Lumo's responses, detects tool calls, and returns them in OpenAI format for your client to execute.

Client tool calls are not native Lumo tools. Whatever `call_id` the client echoes (`toolname__synth__…`, `call_…`, `fc-…`), the result is rewritten to a user message (`[Tool Result: name]` plus the output) before it goes to Proton. Sending the OpenAI tool protocol through would 400.

## Configuration

### Enable Custom Tools

```yaml
server:
  customTools:
    # Honor tools[] from the client. Default is true.
    enabled: true

    # Prefix added to custom tool names to distinguish from Lumo's native tools.
    # Applied to tool definitions sent to Lumo, stripped from tool calls returned to client.
    # Set to "" to disable prefixing. Default "user:".
    prefix: "user:"
```

### Tool Routing (`customTools.routing`)

How native Proton tools and client tools coexist:

```yaml
server:
  customTools:
    routing:
      nativeTools: "auto"   # auto | always | never
```

- **auto** (default): native tools are advertised only when the request carries **no** custom tools. This avoids the tool-mix-up confusion while keeping web search etc. available for plain chats.
- **always**: always advertise native tools (pre-fix behavior; can confuse Lumo when both tool families are present).
- **never**: never advertise native tools — fully deterministic custom-tool-only behavior.

### Reply Recovery (`customTools.recovery`)

Lumo sometimes thinks about a tool call but never emits the JSON block: it ends a reply on a dangling colon, narrates the call in prose (`[Assistant tool call]: …`), or answers with no text at all (thinking-only loop). The recovery bounces send the reply back with a short correction so the model emits the fenced JSON:

```yaml
server:
  customTools:
    recovery:
      bounceDanglingColon: true              # reply ends on a dangling colon after announcing an action
      bounceNarration: true                  # prose narration of a tool call
      bounceBlankReply: true                 # no message text at all
      danglingColonMaxLength: 2000           # max reply length still eligible
      danglingColonLastLineMaxLength: 500    # max last-line length still eligible
```

All bounces are on by default; the lengths cap how large a reply may be before a bounce is pointless (long prose would waste a roundtrip). The bounce text comes from `instructions.forAnnounceBounce`.

### Instruction Modules (`customTools.modules`)

Optional instruction packs appended to `forTools` when enabled — extend the protocol without editing the base template:

```yaml
server:
  customTools:
    modules:
      homeAssistant:
        enabled: false
        prompt: |
          # Home Assistant
          HA proxy tools (ha_call_read_tool, ha_call_write_tool, ha_call_delete_tool)
          have their own nested "name" and "arguments". ...
```

`{{prefix}}` is interpolated at runtime. The module prompt must not repeat the base protocol — it is appended to `forTools`. The Home Assistant module ships as the built-in example; the module fields surface on `/config` under **Prompts → General**.

The module toggle renders in the config editor with the other prompt fields (sorted below the base prompts regardless of YAML position).

### Instructions Template

The instructions sent to Lumo are assembled from a template:

```yaml
server:
  instructions:
    # Template for assembling instructions. Handlebars-like syntax.
    # Available variables: tools, clientInstructions, forTools, fallback, prefix
    template: |
      {{#if tools}}
      {{forTools}}
      {{/if}}

      {{#if clientInstructions}}
      {{clientInstructions}}
      {{else}}
      {{fallback}}
      {{/if}}

      {{#if tools}}
      Below are all the custom tools you can use. Remember, all tools prefixed with `{{prefix}}` are custom tools and must be called by outputting the JSON to the user. Copy each "name" exactly as listed, including `{{prefix}}`. Do not shorten or invent names.

      {{tools}}
      {{/if}}

    # Fallback instructions when no system/developer message is provided
    fallback: |
      Always answer in plain text. Don't use tables, quote blocks, lists, etc. Be concise.

    # Instructions prepended when tools are provided in the request. Can use {{prefix}}.
    forTools: |
      === CUSTOM TOOL PROTOCOL ===
      The tools below are CUSTOM tools, prefixed with `{{prefix}}`.
      ...
      (full text: config.defaults.yaml)
```

The default `forTools` is long and evolves; treat `config.defaults.yaml` as the source of truth rather than a copy here. Its key points: custom tools are **text**, not built-in function calling; JSON goes into a ` ```json ` code block; emit it directly without narrating; results come back as `[Tool Result: name]`; isolated work should prefer the `task` tool (per its schema).

Follow-up turns use `forToolsCompact` instead of `forTools` (when there is more than one user message after flatten). Schemas are still sent in full; only the wrapper is shortened.

Other instruction hooks:

| Key | When injected |
|---|---|
| `forJsonFormat` | client sends `response_format` json_object/json_schema (`{{schema}}` interpolated) |
| `forToolRequired` | `tool_choice: required` |
| `forToolNamed` | `tool_choice: {type: function, function: {name}}` (`{{name}}` interpolated) |
| `forToolBounce` | Lumo routed a call through the native pipeline (the actual call JSON is appended at runtime) |
| `forAnnounceBounce` | dangling colon / narration / blank reply bounce |
| `injectInto` | `first` or `last` user message — only applies when the request has **no** tools; with tools the proxy always injects last |

### Instruction Replace Patterns

Clean up client instructions that might confuse Lumo:

```yaml
server:
  instructions:
    # Search/replace patterns applied to client instructions (case-insensitive regex).
    # Each entry: { pattern: "regex", replacement: "text" } - omit replacement to strip.
    replacePatterns:
      - pattern: "(?<![\\w.:-])(?<!native\\s)(?<!custom\\s)(?<!internal\\s)(?<!external\\s)\\btools?\\b(?![\\w[(.])"
        replacement: "custom $&"
```

The default pattern rewrites standalone prose mentions of "tool(s)" to "custom tool(s)" so Lumo separates client tools from its native ones. Identifiers (`ha_call_read_tool`, `tools.browser.back`, `tool_name`) and qualified phrases (native/custom/internal/external tool) are left untouched.

`tool_choice` (`auto` / `none` / `required` / named function) is honored via the instructions above. `none` drops `tools[]` from the request.

## Troubleshooting

**Tool calls not detected**
- Ensure `customTools.enabled: true`
- Check that Lumo emits JSON in a ```json code block (`{"name":"user:…","arguments":{…}}`)
- If the log says `name not in client tools[]`, Lumo shortened or invented the name. The prompt tells it to copy `name` from the list; a shorter name is not executed.
- The proxy locates a tool blob in the stream, then extracts `{name, arguments}`: strict JSON, jammed objects, then a lenient parse. If it still fails, the log says `[tools] not executed` with the reason.

**Only prose, no tool call** ("I would now edit the file…" and nothing happens)
- Covered by the recovery bounces: dangling colon, narration, blank reply. Check `customTools.recovery.*` are on (they are by default).
- If persistent, shorten instructions — very long system prompts make Lumo forget the protocol mid-reply.

**Wrong tool names**
- Check `customTools.prefix` — it's added to definitions and stripped from responses
- If prefix is causing issues, set to `""` to disable

**Lumo says "I don't have access to that tool"**
- This is a misrouted call being bounced — should resolve automatically
- If persistent, check logs for bounce failures

**OpenCode / Responses API: 400 loop after a tool call**
- Custom tools are detected from text, so the `call_id` is invented by lumo-tamer
- Results are flattened to user text (see above). If you still see 400s, check the log for the Proton error body, not just the client retry.

**Payloads containing triple backticks break the tool call**
- Fixed in this fork: fenced tool calls survive string content that itself contains ``` sequences (string-aware scanner in `streaming-tool-detector.ts`). Older ZeroTricks builds corrupted such payloads.

---

## Native Tools

Lumo has built-in tools executed server-side by Proton:

| Tool | Description |
|------|-------------|
| `proton_info` | Proton product information (always enabled) |
| `web_search` | Web search via Proton's backend |
| `weather` | Weather data |
| `stock` | Stock prices |
| `cryptocurrency` | Cryptocurrency prices |

Image tools were removed from this fork (the upstream image infrastructure no longer exists).

Web search stays off until you turn it on:

```yaml
server:
  enableWebSearch: true
```

Native and custom tools work together per `customTools.routing.nativeTools` (see above).

---

## How Custom Tools Work

1. **Tool definitions are prefixed** with `customTools.prefix` (e.g., `get_weather` becomes `user:get_weather`)
2. **Instructions are assembled** from `instructions.template` with tool definitions as JSON, plus any enabled module prompts appended
3. **Instructions are prepended** to a user message as `[Project instructions: ...]`
   - With client tools the proxy always injects into the **last** user message (so long sessions do not drop the protocol).
   - `instructions.injectInto` only applies when the request has no tools (`first` or `last`).
4. **Lumo outputs tool calls** as JSON in a markdown `json` code block (the detector also accepts a raw line):

   ````
   I'll check the weather for you.
   ```json
   {"name": "user:get_weather", "arguments": {"city": "Paris"}}
   ```
   ````
   *If Lumo misroutes the call or only announces it, lumo-tamer bounces it — see [Misrouted Tool Calls](#misrouted-tool-calls).*
5. **lumo-tamer detects and extracts** tool calls, strips the prefix, and returns in OpenAI format
6. **Your client executes** the tool and sends results back

### Response Format

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "I'll check the weather for you.",
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\": \"Paris\"}"
        }
      }]
    }
  ]}
}
```

---

## Misrouted Tool Calls

Sometimes Lumo routes a custom tool through its native SSE pipeline instead of outputting JSON text. This always fails because Proton's backend doesn't know the tool.

### What Happens

1. lumo-tamer detects the misrouted call (tool name not in `KNOWN_NATIVE_TOOLS`: `proton_info`, `web_search`, `weather`, `stock`, `cryptocurrency`)
2. Suppresses Lumo's error response ("I don't have access to that tool...")
3. Bounces the call back with `instructions.forToolBounce`
4. Lumo re-outputs the tool call as JSON text
5. Normal detection extracts the tool call

This is transparent to API clients — the bounce happens internally.
