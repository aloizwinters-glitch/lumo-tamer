# Updates

No extra updater container. Tamer checks GitHub itself and, on Apply, talks to the Docker engine through a bind-mounted socket.

## What lives where

| What | Where | Why |
|------|--------|-----|
| Channel, GitHub repo, interval, auto-apply, socket path | `config.yaml` → Settings → **Updates** | Tamer reads this at runtime. |
| Which image the deployment runs | **`.env` → `LUMO_TAMER_IMAGE`** | Compose `image:` is set before the container exists. Settings cannot rewrite `.env`. |

Nothing else moved to env. API key, auth, models stay in `config.yaml`. There is **no Watchtower token**.

## Docker socket

One-click updates need `/var/run/docker.sock` mounted on `tamer`. That is root-equivalent on the host: whoever controls the container (or its update source) controls the machine. `docker-compose.yml` therefore leaves the mount commented out; without it, update with `docker compose pull && docker compose up -d`.

If you enable it, keep the port off the internet, use a long random API key, and note that `updates.repository` and `updates.dockerSocket` can only be changed in `config.yaml` on the host, never from the web UI or the API.

Portainer: add the same bind on the `lumo-tamer` container if you did not deploy from this compose file.

Without the socket, the Update button still **checks** GitHub but Apply tells you to mount it (or pull by hand).

## `.env`

```bash
# Must match Settings → channel (stable/main → :latest, dev → :dev)
LUMO_TAMER_IMAGE=ghcr.io/banter240/lumo-tamer:latest
```

## Settings (`updates.*`)

```yaml
updates:
  enabled: true
  channel: "stable"
  repository: "banter240/lumo-tamer"
  checkIntervalHours: 6
  autoApply: false
  dockerSocket: "/var/run/docker.sock"
  githubToken: ""   # optional PAT
```

**`githubToken`** (optional): the anonymous GitHub API allows ~60 requests per hour per IP — enough for manual checks, but a short `checkIntervalHours` can exhaust it and the header chip then reports 403. A fine-grained personal access token (read-only, no scopes needed for public repos) raises the limit to 5000/h. The config value wins over a `GITHUB_TOKEN` environment variable. It is treated like the API key: never shown in the browser, blank-save keeps it, **Clear** removes it. See [Settings → Updates → General](config.md).

**Save** on `/config` reloads `updates.*` in the running process and the header chip re-checks GitHub. No Restart for a channel change. Listen port still needs Restart.

The running **package version** (`0.7.0-dev.7` vs `0.7.0`) decides which track you are on — not whether compose still pins `:dev`. Same version as the selected track → **Up to date**, not “Switch to 0.7.0-dev.7”. Dirty local git does not change that; only `package.json` version does.

Each channel is a **track**, not “newest overall”:

- **stable** (default) = latest GitHub *release* on main (`:latest`). Never a `-dev` tag.
- **dev** = newest prerelease (`:dev`).

If you are on `0.7.0-dev.7` and pick stable, the chip proposes **main’s** version (e.g. `0.7.0` or `0.6.0`), not “dev is still newer”. Switching to an older main build is a **downgrade** — the UI warns that `config.yaml` and the vault may not load. Apply pulls `:latest` or `:dev` for that channel; also set `LUMO_TAMER_IMAGE` in `.env` so the next `compose up` does not roll back. Auto-apply never downgrades.

## What Apply does

1. Pull the GHCR tag this container already runs.
2. Start a **one-shot helper** from that new image (`lumo-tamer-updater`, `--rm`).
3. The helper stops `lumo-tamer`, creates it again with the new image (same mounts/ports/name), starts it, deletes the old container, and exits.

No standing second service.

## Commands

```bash
tamer update
tamer update apply
# chat: /update   /update apply
```

The header on `/auth` and `/config` always shows **Updates** / **Up to date**. Click to re-check GitHub. When a newer release exists it becomes **Update to …** (confirm, then recreate). **Shift+click** the chip force-pulls the current channel image even without a version change (same as `POST /v1/update?force=1`) — the escape hatch when a tag was re-built.

Apply is rate-limited: repeated `POST /v1/update` calls answer 429 after a few attempts. Saving `updates.channel` on `/config` makes the chip re-check immediately; saving other `updates.*` values (interval, token) does not.

## Manual

```bash
docker pull ghcr.io/banter240/lumo-tamer:latest    # or :dev
docker compose up -d tamer
```
