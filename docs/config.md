# Configuration

All options live in [`config.defaults.yaml`](../config.defaults.yaml). Copy what you need into `config.yaml`. Do not edit the defaults file.

User files (`config.yaml`, `sessions/`, logs) sit next to the install. Override with `LUMO_HOME` or `tamer --home /path`.

## Web UI

`http://<host>:3003/config` edits `config.yaml` in the browser. Same header as `/auth`: brand, GitHub, dark/light toggle, and a Settings ↔ Account icon.

- Left nav is categories with sub-categories (Sign-in, Server, Models, Tools, Conversations, Commands, Prompts, Logging, Updates, CLI, Expert). A parent row only expands/collapses; a leaf navigates. The pane shows one leaf at a time; search matches labels and YAML keys across everything.
- **Prompts**: the instruction text Lumo actually sees (`forTools`, fallback, injection point). Drop-in module fields (Home Assistant) render below the base prompts they extend.
- **Expert**: Handlebars `template` glue, vault paths, mock. Leave it.
- Each row has a human title, a short description, the control, and **Default** on the right (not on secrets with a placeholder default, like the API key). Default is teal when a click would restore `config.defaults.yaml`, muted when the value is already the default. **Undo** appears after you edit a field or press Default, and restores the last saved value.
- Secrets never echo their stored value. Saving with the field blank keeps it. Secrets whose default is empty (the GitHub token) show **Clear** instead of Default — one click queues removing the stored value.
- **Export** opens a dialog with a JSON snapshot of every override (`$format`, `version`, `exportedAt`, `changes`). Copy it to the clipboard or paste it on another instance. Secrets are excluded unless you tick *Include secrets*.
- **Import** pastes such a snapshot. **Validate** previews the result without writing: each setting as `old → new`, renames applied from older versions, unknown paths listed as ignored, type errors as warnings. **Apply** merges — settings absent from the snapshot keep their local value. A snapshot from a newer version imports too, with a warning.
- The YAML key is always visible under the description. **More** / **Example(s)** sits next to it only when there is extra copy or a sample; opening it does not move that line. A single-value field has one sample. Two samples are labeled Example 1 / Example 2 (extra model aliases, desktop vs Docker CDP, …). Model lists are comma-separated (`lumo, lumo-max`); extra models are a JSON array.
- **Save**, **Restart**, and **Reset to defaults** sit in the toolbar. Save writes only overrides and hot-reloads in-memory settings (update channel takes effect immediately; the header chip re-checks GitHub). Restart is only needed for listen port / process. Reset restores `config.defaults.yaml` except `server.apiKey` (confirm first, then Save).

Own model names (`server.extraModels`): `id` + `model` (`lumo` / `lumo-lite` / `lumo-max` / `apertus-15`) + optional `reasoning` (`none` / `high`). Example: `lumo-lite-thinking` → Lite with thinking on. Request `reasoning_effort` still wins.

- The page has no login (same as `/auth`). Anyone who can reach the port can change settings.
- `server.apiKey` is a password field and is **never** sent back to the browser. Leave it blank to keep the current key. To read the key, open the file on the host (SSH / Portainer).
- Changing `server.port` here does not update `docker-compose.yml`.
- **Updates** stay in `config.yaml` (channel, repo, interval, auto-apply, socket path). The image pin is `LUMO_TAMER_IMAGE` in `.env`, same as before. Apply uses the Docker socket on this container — no extra updater. See [Updates](updates.md).

```
GET  /config      HTML form
GET  /v1/config   field tree (apiKey redacted)
PUT  /v1/config   apply edits or { resetAll: true } (keeps apiKey); hot-reloads (Restart still needed for port)
GET  /v1/config/export   snapshot of overrides (?secrets=true includes them)
POST /v1/config/import   { snapshot, dryRun } — merge a snapshot; dryRun:true validates only
POST /v1/restart  exit so Docker/tsx-watch can bring the process back
```

## File

```yaml
# config.yaml — only overrides
server:
  apiKey: "your-secret-api-key-here"
```

Common sections: `auth`, `server`, `cli`, `log`, `conversations`, `commands`, `updates`. See the defaults file for every key.