## [0.7.0](https://github.com/banter240/lumo-tamer/compare/v0.6.0...v0.7.0) (2026-11-09)

### Features

* feat(api): proxy core, instructions modules, privacy masking

  Shared request-prep drives both OpenAI routes: userish validation, tool
  choice preparation, injected instructions with per-module toggles,
  reduced cold-start refusals. response_format/json mode support, reply
  recovery fixes, deterministic conversation ids, privacy dump masking
  for the API dump, conversation store hardening, richer mock scenarios,
  listen helper for integration tests.
* feat(app): settings editor, portable config, env overrides

  Full /config editor with sub-categories, sort drop-in modules below base
  prompts, compiled and tested inline scripts. Portable JSON export and
  import. Port and vault-key env overrides with config.yaml hot reload,
  no YAML line folding, LUMO_HOME support, safer proxy defaults and the
  app const/enum SSOT feeding schemas and editor copy.
* feat(auth): password login page, desktop sign-in, sidecar auth

  Lumo-scoped /auth page with SRP password flow, Proton desktop sign-in,
  sidecar login, collapsed login paths. Logout drops the vault even when
  Proton revoke fails; auth-required errors carry a reachable /auth URL.
  Rate-limited config saves, token refresh hardening, vault atomic write
  follows symlinks, Go login CLI fixes including Windows binaryPath.
* feat(cli): interactive prompt and instructions builder

  Interactive CLI prompt; the instructions builder moves from the
  misleading message-converter.ts name to instructions.ts, imported by
  cli/client.ts.
* feat(images): vision input, generation, and editing

  Send image input (vision) to Lumo U2L-encrypted with strict base64
  validation and image bytes excluded from the token estimate. Native
  image generation and editing (generate/edit/describe_image), decrypted
  in the proxy and streamed as markdown data URLs; image tools are only
  offered on turns that involve images.

  Co-authored-by: aloizwinters-glitch <324018590+aloizwinters-glitch@users.noreply.github.com>
* feat(logging): live /logs page backend with redaction

  Redacted ring buffer broadcasting structured logs to the web UI;
  log-redact strips login credentials and secrets, tested against
  realistic field sets. Verbosity stays governed by log.level, message
  content logging remains opt-in.
* feat(lumo-client): completion core refinements

  Per-request trace anchors (tier, turns, images, encrypted, requestId)
  pair with the tool detector stream logs, bounce-once guard for dead tool
  call announcements, response-chunk accumulation in one place, single
  resolveChatModel tier mapping via LUMO_MODEL_TIERS.
* feat(models): Apertus 1.5, thinking variants, reasoning effort mapping

  Apertus 1.5 with alias canonicalization, auto-advertised -thinking
  variants via autoVariants, minimal/xhigh/default reasoning_effort
  values mapped onto Lumo's high/none. Prompt-token estimation
  rebaselined so factor 1.0 is the tuned value.
* feat(tools): robust streaming tool detection

  Fences open only at line start or before a JSON payload, lone and inline
  closers are never emitted, fenced calls survive fences inside payload
  strings. Lenient parser decodes JSON escapes, jammed tool JSON is split
  and repaired, unknown client tools are counted and escalated to warn so
  retry loops surface. flattenToolItem is the single OpenAI-to-Lumo tool
  mapping, choice instructions and announce/extract modules included.
* feat(updates): git and docker self-update with channel switching

  docker.sock self-update prunes old images after a successful recreate,
  git self-update covers bare checkouts, optional GitHub PAT for release
  checks, stable/dev channel switching with downgrade warnings. Stale
  dist is rebuilt on respawn, the listen port is released before restart,
  and /health surfaces the build commit plus a staleness flag on the
  single semver comparator.
* feat(web-ui): served web UI with toasts, auth chip, live log feed

  Click-to-copy toasts (errors linger), global auth status chip with
  sign-out detection, vertical sidebar on narrow screens, compact toolbar
  with searchable type=search settings, log feed with internal scrolling,
  theme toggle without DOM wipe, number input guards, build commit in the
  header, single __ltToast implementation for all bind scripts.

### Bug Fixes

* fix(app): register fallback store in mock mode

  In initializeMock(), when useFallbackStore is true the else-branch
  called getFallbackStore() but never registered it as the active
  conversation store via setConversationStore(). This left the
  activeStore singleton null, so APIServer.getDependencies() threw
  'ConversationStore not initialized - call initializeConversationStore()
  first' on startup, causing a crash loop in mock mode.

  Wrap the call in setConversationStore(), mirroring the primary-store
  branch above.

### Documentation

* docs: fork documentation overhaul

  README rewritten against current code, new docs for /config settings
  and the update system, authentication/opencode/local-actions guides
  updated through the full audit sweep.
