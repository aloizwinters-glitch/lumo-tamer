import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import { createUpdatesRouter } from "../../src/api/routes/updates.js";
import {
  setupAuthMiddleware,
  setupReadyMiddleware,
} from "../../src/api/middleware.js";
import { listen, closeServer } from "../helpers/listen.js";
import { resetUpdateCache } from "../../src/app/updates.js";

// POST /v1/update reaches the real apply flow; without these mocks a clean
// checkout would git-fetch and detach the working copy at a release tag.
vi.mock("../../src/app/docker-update.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/app/docker-update.js")>();
  return {
    ...actual,
    dockerSocketAvailable: () => false,
    dockerEngineReachable: async () => false,
  };
});

vi.mock("../../src/app/git-update.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/app/git-update.js")>();
  return {
    ...actual,
    isGitUpdateable: vi.fn(async () => false),
    applyGitUpdate: vi.fn(async () => {}),
  };
});

describe("update API", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    resetUpdateCache();
    const app = express();
    app.use(express.json());
    app.use(setupAuthMiddleware("test-key"));
    app.use(setupReadyMiddleware(() => false));
    app.use(createUpdatesRouter());
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    resetUpdateCache();
  });

  it("serves GET /v1/update without an API key", async () => {
    const res = await fetch(`${baseUrl}/v1/update`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(body).toMatchObject({
        enabled: true,
        current: expect.any(String),
        channel: expect.stringMatching(/^(stable|dev)$/),
      });
    }
  });

  it("POST /v1/update without Watchtower does not crash", async () => {
    const res = await fetch(`${baseUrl}/v1/update`, { method: "POST" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
    expect([200, 409, 502]).toContain(res.status);
    const body = await res.json();
    expect(body.ok === true || body.ok === false || body.error).toBeTruthy();
  });
});
