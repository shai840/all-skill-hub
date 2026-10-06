// HTTP server: web UI, JSON API for the UI, and a Streamable-HTTP MCP endpoint.
//   /mcp            MCP, adapter auto-detected from clientInfo
//   /mcp/<adapter>  MCP with the adapter forced (e.g. /mcp/chatgpt, /mcp/claude)
//   /api/*          web UI API
//   /               web UI
// Locally it runs open on 127.0.0.1. Hosted (Railway), Google OAuth is required for
// /mcp (bearer tokens) and the web UI (session cookie); see auth.mjs.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore, MEMORY_TYPES, slugify } from "./core/store.mjs";
import { createSession, describeTool, runTool, SERVER_INFO } from "./core/mcp.mjs";
import { ADAPTERS, getAdapter } from "./adapters/index.mjs";
import { createAuth, COOKIE } from "./auth.mjs";
import { createHistory } from "./core/history.mjs";
import { HUB_DIR, WEB_DIR, HOST, PORT, BASE_URL, AUTH, HISTORY, SEED_DIR } from "./config.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const SESSION_IDLE_MS = 60 * 60 * 1000;
const MAX_BODY = 2 * 1024 * 1024;

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string";
  res.writeHead(status, { "content-type": isJson ? "application/json" : "text/plain; charset=utf-8", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/** OAuth endpoints accept form-encoded or JSON bodies. */
function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (/json/i.test(req.headers["content-type"] || "")) {
        try {
          return resolve(raw ? JSON.parse(raw) : {});
        } catch {
          return reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
        }
      }
      resolve(Object.fromEntries(new URLSearchParams(raw)));
    });
    req.on("error", reject);
  });
}

// Browsers on other sites must not be able to drive the hub (DNS-rebinding / CSRF).
// Server-to-server callers (MCP clients, tunnels) send no Origin header.
function originAllowed(req, baseUrl) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const host = new URL(o).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host) || host === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id, www-authenticate",
};

export function createHttpHandler(store, { baseUrl = BASE_URL, auth = null, history = null } = {}) {
  const sessions = new Map();
  const commit = (w) => history?.enabled && history.commit(w);
  setInterval(() => {
    for (const [id, s] of sessions) if (Date.now() - s.state.lastUsed > SESSION_IDLE_MS) sessions.delete(id);
  }, 10 * 60 * 1000).unref();

  async function handleMcp(req, res, forced, user) {
    if (req.method === "GET") return send(res, 405, "This server does not offer an SSE stream; use POST.", { allow: "POST, DELETE" });
    if (req.method === "DELETE") {
      sessions.delete(req.headers["mcp-session-id"]);
      return send(res, 200, {});
    }
    if (req.method !== "POST") return send(res, 405, "Method not allowed", { allow: "POST, DELETE" });
    if (forced) getAdapter(forced); // throws on unknown adapter
    const body = await readBody(req);
    const msgs = Array.isArray(body) ? body : [body];
    const isInit = msgs.some((m) => m?.method === "initialize");
    const sid = req.headers["mcp-session-id"];
    let session;
    const transport = req.headers["x-all-skill-transport"] === "stdio" ? "stdio-proxy" : "http";
    if (isInit) {
      session = createSession({ store, adapterId: forced, transport, baseUrl, user, onWrite: commit });
      session.state.user = user;
      sessions.set(session.state.id, session);
    } else if (sid) {
      session = sessions.get(sid);
      if (session && session.state.user !== user) session = null; // sessions are bound to who opened them
      if (!session) return send(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found; re-initialize" } });
    } else {
      session = createSession({ store, adapterId: forced, transport, baseUrl, user, onWrite: commit }); // stateless call
    }
    const replies = (await Promise.all(msgs.map((m) => session.handle(m)))).filter(Boolean);
    const headers = isInit || sid ? { "mcp-session-id": session.state.id } : {};
    if (!replies.length) {
      res.writeHead(202, headers);
      return res.end();
    }
    send(res, 200, Array.isArray(body) ? replies : replies[0], headers);
  }

  function serveStatic(res, urlPath) {
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const full = path.resolve(WEB_DIR, rel);
    if (!full.startsWith(WEB_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile())
      return serveStatic(res, "/"); // SPA fallback
    res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(full).pipe(res);
  }

  const memoryView = ({ text, ...m }) => m;
  const skillView = ({ text, meta, ...s }) => s;

  async function handleApi(req, res, url, user) {
    const who = user ? `web-ui (${user})` : "web-ui";
    const edited = (what) => {
      store.logActivity({ event: "edit", client: "web-ui", what, ...(user ? { user } : {}) });
      commit({ message: `web-ui: ${what}`, author: who });
    };
    const route = `${req.method} ${url.pathname}`;
    const q = Object.fromEntries(url.searchParams);
    const body = ["POST", "PUT"].includes(req.method) ? (await readBody(req)) || {} : {};

    switch (route) {
      case "GET /api/health":
        return send(res, 200, auth ? { server: SERVER_INFO, ok: true } : { server: SERVER_INFO, hubDir: store.root, pid: process.pid });
      case "GET /api/me":
        return send(res, 200, { user: user || null, auth: Boolean(auth), history: Boolean(history?.enabled), backup: Boolean(history?.remote) });

      case "GET /api/history":
        return send(res, 200, { commits: q.path ? history?.fileLog(q.path) || [] : history?.recent(Number(q.limit) || 50) || [] });
      case "GET /api/history/show": {
        const text = history?.show(q.path, q.rev);
        return text == null ? send(res, 404, { error: "Not found" }) : send(res, 200, { text });
      }
      case "POST /api/history/restore": {
        if (!history?.enabled) return send(res, 400, { error: "History is not enabled" });
        const rev = history.restore(body.path, body.rev, who);
        store.logActivity({ event: "edit", client: "web-ui", what: `restored ${body.path} to ${body.rev}`, ...(user ? { user } : {}) });
        return send(res, 200, { ok: true, rev });
      }
      case "GET /api/overview": {
        const memories = store.listMemories();
        const activity = store.readActivity(500);
        const clients = {};
        for (const a of activity) {
          if (a.event !== "connect" && a.event !== "tool") continue;
          const k = `${a.client}|${a.adapter}`;
          clients[k] ||= { client: a.client, adapter: a.adapter, transport: a.transport, lastSeen: a.ts, calls: 0 };
          if (a.event === "tool") clients[k].calls++;
        }
        return send(res, 200, {
          server: SERVER_INFO,
          hubDir: store.root,
          baseUrl,
          counts: {
            memories: memories.length,
            global: memories.filter((m) => m.scope === "global").length,
            projects: store.listProjects().length,
            skills: store.listSkills().length,
          },
          byType: Object.fromEntries(MEMORY_TYPES.map((t) => [t, memories.filter((m) => m.type === t).length])),
          clients: Object.values(clients),
          recentMemories: memories.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 4).map(memoryView),
          activity: activity.slice(0, 12),
        });
      }
      case "GET /api/profile":
        return send(res, 200, { text: store.getProfile() });
      case "PUT /api/profile":
        edited("profile");
        return send(res, 200, { text: store.saveProfile(body.text) });
      case "GET /api/policy":
        return send(res, 200, { text: store.getPolicy() });
      case "PUT /api/policy":
        edited("saving policy");
        return send(res, 200, { text: store.savePolicy(body.text) });

      case "GET /api/memories": {
        const list = q.q
          ? store.searchMemories(q.q, { include: "all", limit: 200 })
          : store.listMemories();
        return send(res, 200, { memories: list.map(memoryView), projects: store.listProjects(), types: MEMORY_TYPES });
      }
      case "GET /api/memory": {
        const m = store.getMemory(q.id);
        return m ? send(res, 200, { memory: { ...m, backlinks: store.backlinks(m.name) } }) : send(res, 404, { error: "Not found" });
      }
      case "PUT /api/memory": {
        // originalId lets the UI rename a memory or move it between scopes.
        const targetId = `${body.project ? slugify(body.project) : "global"}/${slugify(body.name)}`;
        const old = store.getMemory(body.originalId || targetId);
        const version = old && old.id === targetId ? body.version || "" : "new";
        const r = store.saveMemory({ ...body, version, source: who });
        if (old && old.id !== r.memory.id) store.deleteMemory(old.id);
        edited(`memory ${r.memory.id}`);
        return send(res, 200, { memory: memoryView(r.memory), created: !old });
      }
      case "DELETE /api/memory": {
        const m = store.deleteMemory(q.id);
        if (m) edited(`deleted memory ${m.id}`);
        return m ? send(res, 200, { deleted: m.id }) : send(res, 404, { error: "Not found" });
      }

      case "GET /api/skills":
        return send(res, 200, { skills: (q.q ? store.findSkills(q.q, 50) : store.listSkills()).map(skillView) });
      case "GET /api/skill": {
        const s = store.getSkill(q.name);
        return s ? send(res, 200, { skill: skillView(s) }) : send(res, 404, { error: "Not found", suggestions: store.findSkills(q.name).map((x) => x.name) });
      }
      case "GET /api/skill/file": {
        const f = store.readSkillFile(q.name, q.path);
        return f ? send(res, 200, { path: f.path, content: f.content }) : send(res, 404, { error: "Not found" });
      }
      case "GET /api/source": {
        const d = store.getSource(q.id);
        return d ? send(res, 200, { source: d }) : send(res, 404, { error: "Not found" });
      }
      case "PUT /api/skill": {
        const r = store.saveSkill({ ...body, version: body.version || "new" });
        edited(`skill ${r.skill.name}`);
        return send(res, 200, { skill: skillView(r.skill), created: r.created });
      }
      case "DELETE /api/skill": {
        const s = store.deleteSkill(q.name);
        if (s) edited(`deleted skill ${s.name}`);
        return s ? send(res, 200, { deleted: s.name }) : send(res, 404, { error: "Not found" });
      }

      case "GET /api/activity":
        return send(res, 200, { activity: store.readActivity(Number(q.limit) || 300) });

      case "GET /api/adapters":
        return send(res, 200, {
          adapters: ADAPTERS.map((a) => ({
            id: a.id,
            label: a.label,
            summary: a.summary,
            endpoint: `${baseUrl}/mcp/${a.id}`,
            instructions: a.instructions({ store, baseUrl }),
            tools: a.tools.map(describeTool),
          })),
          autoEndpoint: `${baseUrl}/mcp`,
        });
      case "POST /api/preview": {
        const tool = getAdapter(body.adapter).tools.find((t) => t.name === body.tool);
        if (!tool?.annotations?.readOnlyHint) return send(res, 400, { error: "Only read-only tools can be previewed" });
        return send(res, 200, await runTool(store, body.adapter, body.tool, body.args, { baseUrl }));
      }
    }
    send(res, 404, { error: `No route ${route}` });
  }

  const secure = baseUrl.startsWith("https:");
  const sessionCookie = (value, maxAge) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  function oauthFail(res, e) {
    if (e.oauth) return send(res, e.status || 400, e.oauth, CORS);
    throw e;
  }

  function errorPage(res, status, message) {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>All-Skill Hub</title>
<body style="font:16px/1.5 -apple-system,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px"><h1 style="font-size:22px">Can't sign you in</h1><p>${String(message).replace(/[<>&]/g, "")}</p><p><a href="/login">Try again</a></p></body>`);
  }

  async function handleAuth(req, res, url) {
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (p.startsWith("/.well-known/oauth-protected-resource"))
      return send(res, 200, auth.resourceMetadata(p.slice("/.well-known/oauth-protected-resource".length) || "/mcp"), CORS);
    if (p.startsWith("/.well-known/oauth-authorization-server") || p.startsWith("/.well-known/openid-configuration"))
      return send(res, 200, auth.authServerMetadata(), CORS);
    try {
      if (p === "/register" && req.method === "POST") return send(res, 201, auth.register(await readForm(req)), CORS);
      if (p === "/token" && req.method === "POST")
        return send(res, 200, auth.token(await readForm(req), req.headers.authorization), { ...CORS, "cache-control": "no-store" });
      if (p === "/revoke" && req.method === "POST") {
        auth.revoke(await readForm(req));
        return send(res, 200, {}, CORS);
      }
    } catch (e) {
      return oauthFail(res, e);
    }
    if (p === "/authorize") {
      try {
        res.writeHead(302, { location: auth.authorize(q) });
        return res.end();
      } catch (e) {
        return errorPage(res, e.status || 400, e.message);
      }
    }
    if (p === "/login") {
      res.writeHead(302, { location: auth.webLogin(q.return || "/") });
      return res.end();
    }
    if (p === "/logout") {
      auth.logout(req);
      res.writeHead(302, { location: "/", "set-cookie": sessionCookie("", 0) });
      return res.end();
    }
    if (p === "/auth/callback") {
      try {
        const r = await auth.callback(q);
        const headers = { location: r.redirect };
        if (r.cookie) headers["set-cookie"] = sessionCookie(r.cookie, 30 * 24 * 3600);
        store.logActivity({ event: "login", client: r.cookie ? "web-ui" : "oauth", user: r.email });
        res.writeHead(302, headers);
        return res.end();
      } catch (e) {
        return errorPage(res, e.status || 400, e.message);
      }
    }
    return false;
  }

  const AUTH_PATHS = /^\/(\.well-known\/(oauth-|openid-)|register$|token$|revoke$|authorize$|login$|logout$|auth\/callback$)/;

  return async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      if (auth && AUTH_PATHS.test(url.pathname)) {
        const handled = await handleAuth(req, res, url);
        if (handled !== false) return;
      }
      const mcp = url.pathname.match(/^\/mcp(?:\/([a-z0-9-]+))?\/?$/);
      if (mcp) {
        if (auth && req.method === "OPTIONS") {
          res.writeHead(204, CORS);
          return res.end();
        }
        let user = null;
        if (auth) {
          const t = auth.verifyBearer(req);
          if (!t)
            return send(res, 401, { error: "unauthorized", error_description: "Sign in required" }, { ...CORS, "www-authenticate": auth.challenge(url.pathname.replace(/\/$/, "")) });
          user = t.email;
        } else if (!originAllowed(req, baseUrl)) return send(res, 403, { error: "Origin not allowed" });
        return await handleMcp(req, res, mcp[1] || null, user);
      }
      if (url.pathname.startsWith("/api/")) {
        if (!originAllowed(req, baseUrl)) return send(res, 403, { error: "Origin not allowed" });
        let user = null;
        if (auth && url.pathname !== "/api/health") {
          const t = auth.verifyCookie(req) || auth.verifyBearer(req);
          if (!t) return send(res, 401, { error: "Sign in required", login: `/login?return=${encodeURIComponent("/")}` });
          user = t.email;
        }
        return await handleApi(req, res, url, user);
      }
      if (req.method === "GET") {
        // Keep the brand icon available on the sign-in journey, but never send
        // the app shell or its assets before the browser has a session.
        if (auth && !["/icon.png", "/favicon.ico"].includes(url.pathname) && !auth.verifyCookie(req)) {
          res.writeHead(302, { location: `/login?return=${encodeURIComponent(url.pathname + url.search)}`, "cache-control": "no-store" });
          return res.end();
        }
        return serveStatic(res, url.pathname);
      }
      send(res, 405, "Method not allowed");
    } catch (e) {
      if (!res.headersSent) send(res, e.status || (e.userFacing ? 400 : 500), { error: e.message });
    }
  };
}

/** Start the server; resolves to the server, or null if the port is already taken (another hub is running). */
export function startHttp({ store = createStore(HUB_DIR), port = PORT, host = HOST, baseUrl = BASE_URL, quietIfInUse = false, auth = null, history = null } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createHttpHandler(store, { baseUrl, auth, history }));
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE" && quietIfInUse) resolve(null);
      else reject(e);
    });
    server.listen(port, host, () => resolve(server));
  });
}

/** Hosted boot: seed an empty volume from the bundled hub, then turn on history + auth from env. */
function hostedSetup() {
  const log = (m) => console.error(`[all-skill] ${m}`);
  if (SEED_DIR && path.resolve(SEED_DIR) !== HUB_DIR && !fs.existsSync(path.join(HUB_DIR, "profile.md")) && fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(HUB_DIR, { recursive: true });
    fs.cpSync(SEED_DIR, HUB_DIR, { recursive: true, filter: (src) => !/\.activity\.jsonl$|\.DS_Store$/.test(src) });
    log(`seeded ${HUB_DIR} from ${SEED_DIR}`);
  }
  const store = createStore(HUB_DIR);
  let history = null;
  if (HISTORY.enabled) {
    history = createHistory({ dir: HUB_DIR, remote: HISTORY.remote, branch: HISTORY.branch, log });
    history.init();
  }
  let auth = null;
  if (AUTH.enabled) {
    auth = createAuth({ baseUrl: BASE_URL, stateFile: AUTH.stateFile, google: AUTH.google, allowedEmails: AUTH.allowedEmails, allowedDomain: AUTH.allowedDomain });
    log(`Google sign-in on; allowed: ${[...AUTH.allowedEmails, AUTH.allowedDomain && `@${AUTH.allowedDomain}`].filter(Boolean).join(", ") || "(nobody)"}`);
    log(`Google redirect URI to register: ${auth.callbackUrl}`);
  } else if (AUTH.required) {
    throw new Error("Refusing to start: hosted mode needs MCP_AUTH_GOOGLE_CLIENT_ID and MCP_AUTH_GOOGLE_CLIENT_SECRET");
  }
  return { store, history, auth };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve()
    .then(() => startHttp(hostedSetup()))
    .then((s) => {
      console.error(`All-Skill hub running at ${BASE_URL}  (hub: ${HUB_DIR})`);
      console.error(`  MCP: ${BASE_URL}/mcp  ·  ${ADAPTERS.map((a) => `${BASE_URL}/mcp/${a.id}`).join("  ·  ")}`);
      return s;
    })
    .catch((e) => {
      if (e.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is in use; the hub is probably already running at ${BASE_URL}`);
        process.exit(3); // daemon.mjs treats 3 as "another hub owns the port"
      }
      console.error(e);
      process.exit(1);
    });
}
