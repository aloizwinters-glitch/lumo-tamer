import { spawn } from "child_process";
import type { Server } from "http";
import { readFileSync, utimesSync, watch } from "fs";
import express from "express";
import { parseDocument } from "yaml";
import {
  getServerConfig,
  getMetricsConfig,
  authConfig,
  reloadConfig,
  parseServerUserConfig,
} from "../app/config.js";
import { isContainerEnv } from "../app/env.js";
import { resolveDataPath, PROJECT_ROOT } from "../app/paths.js";
import { isInstallStale, isBuildStale } from "../app/staleness.js";
import { getConfigPath } from "../app/config-file.js";
import { logger } from "../app/logger.js";
import { isLoopbackHostname } from "./access.js";
import {
  createUiLoginRouter,
  setupAuthMiddleware,
  setupLoggingMiddleware,
  setupMetricsMiddleware,
  setupReadyMiddleware,
} from "./middleware.js";
import { setupApiErrorHandler } from "./error-handler.js";
import { createHealthRouter } from "./routes/health.js";
import { createModelsRouter } from "./routes/models.js";
import { createChatCompletionsRouter } from "./routes/chat-completions/index.js";
import { createResponsesRouter } from "./routes/responses/index.js";
import { createAuthRouter } from "./routes/auth.js";
import { createConfigRouter } from "./routes/config.js";
import { createUpdatesRouter } from "./routes/updates.js";
import { createLogsRouter } from "./routes/logs.js";
import { setGitRestartHook, startUpdateChecker } from "../app/updates.js";
import { EndpointDependencies } from "./types.js";
import { RequestQueue } from "./queue.js";
import { initMetrics, type MetricsService } from "../app/metrics.js";
import { createMetricsRouter } from "./routes/metrics.js";
import type { Application } from "../app/index.js";
import { VERSION } from "../app/version.js";

function isWeakApiKey(key: string): boolean {
  return key === "your-secret-api-key-here" || key.length < 24;
}

export class APIServer {
  private expressApp: express.Application;
  private httpServer?: Server;
  private serverConfig = getServerConfig();
  private queue = new RequestQueue(1); // Process one request at a time
  private metrics: MetricsService | null = null;
  private deps: EndpointDependencies;

  constructor(private app: Application) {
    this.expressApp = express();
    const metricsConfig = getMetricsConfig();
    if (metricsConfig.enabled) {
      this.metrics = initMetrics(metricsConfig);
    }
    this.deps = this.buildDependencies();
    this.app.setOnSessionInvalid(() => {
      this.refreshAuthBindings();
      logger.warn("Session invalidated; waiting for /auth re-login");
    });
    this.setupMiddleware();
    this.setupRoutes();
  }

  refreshAuthBindings(): void {
    Object.assign(this.deps, this.buildDependencies());
  }

  private setupMiddleware(): void {
    this.expressApp.use(express.json({ limit: this.serverConfig.bodyLimit }));
    this.expressApp.use(express.urlencoded({ extended: false }));
    this.expressApp.use(setupAuthMiddleware(this.serverConfig.apiKey));
    this.expressApp.use(setupReadyMiddleware(() => this.app.isAuthenticated()));
    this.expressApp.use(setupLoggingMiddleware());
    if (this.metrics) {
      this.expressApp.use(setupMetricsMiddleware(this.metrics));
    }
  }

  private setupRoutes(): void {
    if (this.metrics) {
      this.expressApp.use(createMetricsRouter(this.metrics));
    }

    this.expressApp.use(createUiLoginRouter(this.serverConfig.apiKey));
    this.expressApp.use(createHealthRouter(this.deps));
    this.expressApp.use(createModelsRouter());
    this.expressApp.use(createChatCompletionsRouter(this.deps));
    this.expressApp.use(createResponsesRouter(this.deps));
    this.expressApp.use(
      createAuthRouter(this.deps, {
        onAuthenticated: async () => {
          await this.app.applyVaultAuth();
          this.refreshAuthBindings();
          logger.info("Auth vault loaded into the running server");
        },
        onLoggedOut: () => {
          this.app.clearAuth();
          this.refreshAuthBindings();
          logger.info("Signed out; waiting for /auth");
        },
        getSessionNotice: () => this.app.getSessionNotice(),
      }),
    );
    this.expressApp.use(createUpdatesRouter());
    setGitRestartHook(() => restartAfterConfigSave(this.httpServer));
    this.expressApp.use(createLogsRouter());
    this.expressApp.use(
      createConfigRouter(this.app, {
        onSaved: () => {
          restartAfterConfigSave(this.httpServer);
        },
      }),
    );

    this.expressApp.use(setupApiErrorHandler());
  }

  private buildDependencies(): EndpointDependencies {
    const vaultPath = resolveDataPath(authConfig.vault.path);

    return {
      queue: this.queue,
      lumoClient: this.app.isAuthenticated()
        ? this.app.getLumoClient()
        : undefined,
      conversationStore: this.app.getConversationStore(),
      syncInitialized: this.app.isSyncInitialized(),
      authManager: this.app.getAuthManager(),
      vaultPath,
      sessionNotice: this.app.getSessionNotice(),
    };
  }

  async start(): Promise<void> {
    const { validateTemplateOnce } = await import("./instructions.js");
    validateTemplateOnce(this.serverConfig.instructions.template);

    return new Promise((resolve) => {
      const host = this.serverConfig.host;
      this.httpServer = this.expressApp.listen(
        this.serverConfig.port,
        host,
        () => {
          logger.info("========================================");
          logger.info(`lumo-tamer v${VERSION} is ready!`);
          logger.info(
            `  base_url: http://localhost:${this.serverConfig.port}/v1`,
          );
          logger.info(
            `  auth:     http://localhost:${this.serverConfig.port}/auth`,
          );
          logger.info(
            `  config:   http://localhost:${this.serverConfig.port}/config`,
          );
          logger.info(
            `  api_key:  ${this.serverConfig.apiKey.substring(0, 3)}...`,
          );
          const exposed = !isLoopbackHostname(
            host.startsWith("[") || !host.includes(":") ? host : `[${host}]`,
          );
          logger.info(
            exposed
              ? `  listen:   ${host} (reachable from other devices; web UI needs the API key there)`
              : `  listen:   ${host} (this machine only)`,
          );
          if (exposed && isWeakApiKey(this.serverConfig.apiKey)) {
            logger.warn(
              "server.apiKey is the example value or shorter than 24 characters while the server is reachable from other devices. Anyone on the network can use your Lumo account: set a long random key.",
            );
          }
          if (!this.app.isAuthenticated()) {
            logger.warn("Not logged in yet. Open /auth and sign in to Proton.");
          }
          logger.info("========================================\n");
          startUpdateChecker();
          watchConfigForReload();
          resolve();
        },
      );
    });
  }
}

/**
 * Hot-reload config.yaml on disk changes (editor, another instance writing
 * through a symlink). Invalid content keeps the running config; port/apiKey
 * only apply after restart.
 */
function watchConfigForReload(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    watch(getConfigPath(), () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const before = getServerConfig();
          const doc = parseDocument(readFileSync(getConfigPath(), "utf8"));
          if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
          parseServerUserConfig((doc.toJS() ?? {}) as Record<string, unknown>);
          reloadConfig();
          const after = getServerConfig();
          logger.info("config.yaml changed — hot-reloaded");
          if (before.port !== after.port)
            logger.warn("server.port changed — needs restart");
          if (before.apiKey !== after.apiKey)
            logger.warn("server.apiKey changed — needs restart");
        } catch (err) {
          logger.warn(
            { err },
            "config.yaml changed but invalid — keeping current config",
          );
        }
      }, 250);
    });
  } catch (err) {
    logger.debug({ err }, "config.yaml not watchable");
  }
}

/** Docker/k8s restart the PID. Local `tsx watch` only restarts on file changes. */
function restartAfterConfigSave(httpServer?: Server): void {
  logger.info("Restart triggered — shutting down...");
  if (isContainerEnv()) {
    process.exit(0);
  }
  if (parentIsTsxWatch()) {
    try {
      const entry = process.argv[1];
      if (entry) utimesSync(entry, new Date(), new Date());
      logger.info("Poked tsx watch — waiting for restart");
    } catch (err) {
      logger.warn({ err }, "Could not poke tsx watch, respawning");
      respawnSelf();
    }
    process.exit(0);
  }
  logger.info("Not in Docker/tsx-watch — respawning self");
  if (!httpServer) {
    respawnSelf();
    process.exit(0);
  }
  let respawned = false;
  const respawn = (): void => {
    if (respawned) return;
    respawned = true;
    respawnSelf();
    process.exit(0);
  };
  try {
    httpServer.closeAllConnections();
  } catch {
    /* pre-18.2 Node */
  }
  httpServer.close(respawn);
  setTimeout(respawn, 2000).unref();
}

function parentIsTsxWatch(): boolean {
  try {
    const cmd = readFileSync(`/proc/${process.ppid}/cmdline`, "utf8");
    return cmd.includes("tsx") && cmd.includes("watch");
  } catch {
    return false;
  }
}

function respawnSelf(): void {
  const args = [
    ...process.execArgv,
    ...process.argv.slice(1).filter((arg) => arg !== "watch"),
  ];
  const spawnDirect = (): void => {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "inherit",
      env: process.env,
    });
    child.unref();
  };

  // tsx dev runs from src/ — nothing to rebuild, respawn as-is.
  const runFromDist = /(?:^|[\\/])dist[\\/]/.test(process.argv[1] ?? "");
  if (!runFromDist) {
    spawnDirect();
    return;
  }

  // rsync-style deploys sync src/ but not dist/. Without this chain the
  // restart button would happily restart the previous build forever.
  const pre: string[] = [];
  if (isInstallStale(PROJECT_ROOT))
    pre.push("npm install --no-audit --no-fund");
  if (isBuildStale(PROJECT_ROOT)) pre.push("npm run build");
  if (pre.length === 0) {
    spawnDirect();
    return;
  }

  logger.info(
    { steps: pre },
    "Source changed since the last build — rebuilding before respawn",
  );
  const command = [
    ...pre,
    `exec ${[process.execPath, ...args].map(shellQuote).join(" ")}`,
  ].join(" && ");
  try {
    const child = spawn("/bin/sh", ["-c", command], {
      detached: true,
      stdio: "inherit",
      cwd: PROJECT_ROOT,
      env: process.env,
    });
    child.unref();
  } catch (err) {
    logger.warn({ err }, "Chained respawn failed — starting without rebuild");
    spawnDirect();
  }
}

function shellQuote(arg: string): string {
  return /^[\w./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
