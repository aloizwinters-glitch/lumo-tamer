import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { request as httpRequest } from "http";
import {
  createUiLoginRouter,
  setupAuthMiddleware,
} from "../../src/api/middleware.js";
import { UI_SESSION_COOKIE, uiSessionToken } from "../../src/api/access.js";
import { listen, closeServer } from "../helpers/listen.js";

const KEY = "test-key-that-is-long-enough-123";

/** Raw request so the Host header can be set (fetch forbids it). */
function call(
  baseUrl: string,
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: opts.method ?? "GET",
        headers: opts.headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe("web UI access", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(setupAuthMiddleware(KEY));
    app.use(createUiLoginRouter(KEY));
    app.get("/config", (_req, res) => res.type("html").send("config page"));
    app.post("/v1/restart", (_req, res) => res.json({ ok: true }));
    app.get("/v1/models", (_req, res) => res.json({ data: [] }));
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("opens UI pages from this machine without a key", async () => {
    const res = await call(baseUrl, "/config");
    expect(res.status).toBe(200);
    expect(res.body).toBe("config page");
  });

  it("accepts localhost names in the Host header", async () => {
    const port = new URL(baseUrl).port;
    for (const host of [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `app.localhost:${port}`,
    ]) {
      expect(
        (await call(baseUrl, "/config", { headers: { Host: host } })).status,
        host,
      ).toBe(200);
    }
  });

  it("blocks a foreign Host header (DNS rebinding) and sends browsers to the unlock page", async () => {
    const api = await call(baseUrl, "/config", {
      headers: { Host: "evil.example" },
    });
    expect(api.status).toBe(401);
    const page = await call(baseUrl, "/config", {
      headers: { Host: "evil.example", Accept: "text/html" },
    });
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/ui-login?next=%2Fconfig");
  });

  it("opens UI pages for a foreign host with the Bearer key or the unlock cookie", async () => {
    expect(
      (
        await call(baseUrl, "/config", {
          headers: { Host: "nas.lan", Authorization: `Bearer ${KEY}` },
        })
      ).status,
    ).toBe(200);
    const cookie = `${UI_SESSION_COOKIE}=${uiSessionToken(KEY)}`;
    expect(
      (
        await call(baseUrl, "/config", {
          headers: { Host: "nas.lan", Cookie: cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(baseUrl, "/config", {
          headers: { Host: "nas.lan", Cookie: `${UI_SESSION_COOKIE}=forged` },
        })
      ).status,
    ).toBe(401);
  });

  it("ui-logout clears the unlock cookie and sends the browser back to the login page", async () => {
    const out = await call(baseUrl, "/ui-logout", {
      method: "POST",
      headers: { Host: "nas.lan" },
    });
    expect(out.status).toBe(303);
    expect(out.headers.location).toBe("/ui-login");
    const setCookie = String(out.headers["set-cookie"]);
    expect(setCookie).toContain(`${UI_SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("blocks cross-site logout posts (CSRF)", async () => {
    expect(
      (
        await call(baseUrl, "/ui-logout", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("unlock page sets an HttpOnly SameSite=Strict cookie only for the right key", async () => {
    const headers = {
      Host: "nas.lan",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const wrong = await call(baseUrl, "/ui-login", {
      method: "POST",
      headers,
      body: "key=nope&next=%2Fconfig",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers["set-cookie"]).toBeUndefined();

    const ok = await call(baseUrl, "/ui-login", {
      method: "POST",
      headers,
      body: `key=${KEY}&next=%2Fconfig`,
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe("/config");
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toContain(`${UI_SESSION_COOKIE}=${uiSessionToken(KEY)}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain(KEY);
  });

  it("unlock page never redirects off-site", async () => {
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    for (const next of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
    ]) {
      const res = await call(baseUrl, "/ui-login", {
        method: "POST",
        headers,
        body: `key=${KEY}&next=${encodeURIComponent(next)}`,
      });
      expect(res.headers.location, next).toBe("/config");
    }
  });

  it("blocks cross-site writes from a browser even on this machine (CSRF)", async () => {
    expect(
      (
        await call(baseUrl, "/v1/restart", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(baseUrl, "/v1/restart", {
          method: "POST",
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(baseUrl, "/v1/restart", {
          method: "POST",
          headers: { Origin: "null" },
        })
      ).status,
    ).toBe(403);
    const port = new URL(baseUrl).port;
    expect(
      (
        await call(baseUrl, "/v1/restart", {
          method: "POST",
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            "Sec-Fetch-Site": "same-origin",
          },
        })
      ).status,
    ).toBe(200);
  });

  it("API routes still need the Bearer key, even from this machine", async () => {
    expect((await call(baseUrl, "/v1/models")).status).toBe(401);
    expect(
      (
        await call(baseUrl, "/v1/models", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(baseUrl, "/v1/models", {
          headers: { Authorization: `Bearer ${KEY}` },
        })
      ).status,
    ).toBe(200);
  });
});
