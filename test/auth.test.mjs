import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { createStore } from "../server/core/store.mjs";
import { createHistory } from "../server/core/history.mjs";
import { createAuth } from "../server/auth.mjs";
import { startHttp } from "../server/http.mjs";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

/** A stand-in for Google's token endpoint that signs in whoever `who.email` is. */
async function fakeGoogle(who) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const f = Object.fromEntries(new URLSearchParams(raw));
      if (f.client_secret !== "g-secret" || !f.code_verifier) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "invalid_client" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id_token: `${b64({ alg: "none" })}.${b64({ iss: "https://accounts.google.com", aud: "g-client", email: who.email, email_verified: true })}.` }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, tokenUrl: `http://127.0.0.1:${server.address().port}/token` };
}

async function hostedHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "all-skill-auth-"));
  const hub = path.join(dir, "hub");
  const store = createStore(hub);
  fs.writeFileSync(path.join(hub, "profile.md"), "# Me\n");
  const history = createHistory({ dir: hub });
  history.init();
  const who = { email: "owner@example.com" };
  const g = await fakeGoogle(who);
  // Port is needed for baseUrl, so listen first with a placeholder auth, then swap in.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const auth = createAuth({
    baseUrl: base,
    stateFile: path.join(dir, "auth-state.json"),
    google: { clientId: "g-client", clientSecret: "g-secret", authUrl: "https://accounts.example/auth", tokenUrl: g.tokenUrl },
    allowedEmails: ["owner@example.com"],
  });
  const server = await startHttp({ store, port, baseUrl: base, auth, history });
  const close = () => (server.close(), g.server.close());
  return { base, store, history, who, close, dir };
}

const noFollow = { redirect: "manual" };

/** Runs the full MCP-client OAuth dance and returns an access token. */
async function signIn(base) {
  const reg = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
  }).then((r) => r.json());
  const verifier = "v".repeat(50);
  const authz = await fetch(
    `${base}/authorize?` +
      new URLSearchParams({ client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", code_challenge: s256(verifier), code_challenge_method: "S256", state: "xyz" }),
    noFollow
  );
  assert.equal(authz.status, 302);
  const google = new URL(authz.headers.get("location"));
  assert.equal(google.origin, "https://accounts.example");
  assert.equal(google.searchParams.get("redirect_uri"), `${base}/auth/callback`);
  const cb = await fetch(`${base}/auth/callback?code=google-code&state=${google.searchParams.get("state")}`, noFollow);
  if (cb.status !== 302) return { status: cb.status, text: await cb.text() };
  const back = new URL(cb.headers.get("location"));
  assert.equal(back.origin + back.pathname, "https://claude.ai/api/mcp/auth_callback");
  assert.equal(back.searchParams.get("state"), "xyz");
  const tok = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: verifier }),
  }).then((r) => r.json());
  return { ...tok, client_id: reg.client_id, verifier };
}

const mcp = (base, token, body, extra = {}) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify(body),
  });

test("oauth: discovery, 401 challenge, DCR, Google bridge, PKCE, MCP call, refresh rotation", async () => {
  const h = await hostedHub();
  try {
    const unauth = await mcp(h.base, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate"), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
    const prm = await fetch(`${h.base}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json());
    assert.equal(prm.resource, `${h.base}/mcp`);
    const asm = await fetch(`${h.base}/.well-known/oauth-authorization-server`).then((r) => r.json());
    assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
    assert.equal(asm.registration_endpoint, `${h.base}/register`);

    const tok = await signIn(h.base);
    assert.equal(tok.token_type, "Bearer");
    const init = await mcp(h.base, tok.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai" } } });
    assert.equal(init.status, 200);
    const sid = init.headers.get("mcp-session-id");
    const write = await mcp(h.base, tok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory_write", arguments: { name: "hosted", description: "d", type: "user", body: "b" } } }, { "mcp-session-id": sid }).then((r) => r.json());
    assert.match(write.result.content[0].text, /Saved new/);
    assert.equal(h.history.fileLog("memories/global/hosted.md")[0].author, "claude-ai via claude");

    const garbage = await mcp(h.base, "nope", { jsonrpc: "2.0", id: 3, method: "tools/list" });
    assert.equal(garbage.status, 401);

    const refreshed = await fetch(`${h.base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: tok.client_id }),
    }).then((r) => r.json());
    assert.ok(refreshed.access_token && refreshed.access_token !== tok.access_token);
    const reuse = await fetch(`${h.base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: tok.client_id }),
    });
    assert.equal(reuse.status, 400, "refresh tokens are single-use");
  } finally {
    h.close();
  }
});

test("oauth: a Google account that isn't allowlisted gets no tokens", async () => {
  const h = await hostedHub();
  h.who.email = "someone@else.com";
  try {
    const r = await signIn(h.base);
    assert.equal(r.status, 403);
    assert.match(r.text, /not allowed/);
  } finally {
    h.close();
  }
});

test("oauth: PKCE mismatch and wrong redirect are rejected", async () => {
  const h = await hostedHub();
  try {
    const reg = await fetch(`${h.base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] }) }).then((r) => r.json());
    const bad = await fetch(`${h.base}/authorize?` + new URLSearchParams({ client_id: reg.client_id, redirect_uri: "https://evil.example/cb", response_type: "code", code_challenge: "x", code_challenge_method: "S256" }), noFollow);
    assert.equal(bad.status, 400);
    const httpReg = await fetch(`${h.base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
    assert.equal(httpReg.status, 400);
  } finally {
    h.close();
  }
});

test("web ui: API needs a session cookie; Google login sets it; history and restore work", async () => {
  const h = await hostedHub();
  try {
    const shell = await fetch(`${h.base}/`, noFollow);
    assert.equal(shell.status, 302, "the app shell must not render before sign-in");
    assert.equal(shell.headers.get("location"), "/login?return=%2F");
    const asset = await fetch(`${h.base}/app.js`, noFollow);
    assert.equal(asset.status, 302);
    const icon = await fetch(`${h.base}/icon.png`, noFollow);
    assert.equal(icon.status, 200, "the icon stays visible during sign-in");
    const anon = await fetch(`${h.base}/api/overview`);
    assert.equal(anon.status, 401);
    assert.equal((await fetch(`${h.base}/api/health`)).status, 200);

    const login = await fetch(`${h.base}/login?return=%2F%23%2Fmemories`, noFollow);
    const state = new URL(login.headers.get("location")).searchParams.get("state");
    const cb = await fetch(`${h.base}/auth/callback?code=c&state=${state}`, noFollow);
    assert.equal(cb.headers.get("location"), "/#/memories");
    const cookie = cb.headers.get("set-cookie").split(";")[0];
    const H = { cookie, "content-type": "application/json" };

    const signedInShell = await fetch(`${h.base}/`, { headers: H, redirect: "manual" });
    assert.equal(signedInShell.status, 200);
    assert.match(await signedInShell.text(), /id="app"/);
    const unsafeLogin = await fetch(`${h.base}/login?return=%2F%2Fevil.example`, noFollow);
    const unsafeState = new URL(unsafeLogin.headers.get("location")).searchParams.get("state");
    const unsafeCallback = await fetch(`${h.base}/auth/callback?code=c&state=${unsafeState}`, noFollow);
    assert.equal(unsafeCallback.headers.get("location"), "/", "sign-in only returns to a local path");

    const me = await fetch(`${h.base}/api/me`, { headers: H }).then((r) => r.json());
    assert.equal(me.user, "owner@example.com");
    const v1 = await fetch(`${h.base}/api/memory`, { method: "PUT", headers: H, body: JSON.stringify({ name: "pet", description: "d", type: "user", body: "cat" }) }).then((r) => r.json());
    await fetch(`${h.base}/api/memory`, { method: "PUT", headers: H, body: JSON.stringify({ originalId: "global/pet", version: v1.memory.version, name: "pet", description: "d", type: "user", body: "dog" }) });
    const commits = await fetch(`${h.base}/api/history?path=memories/global/pet.md`, { headers: H }).then((r) => r.json());
    assert.equal(commits.commits.length, 2);
    assert.match(commits.commits[0].author, /web-ui \(owner@example\.com\)/);
    await fetch(`${h.base}/api/history/restore`, { method: "POST", headers: H, body: JSON.stringify({ path: "memories/global/pet.md", rev: commits.commits[1].rev }) });
    assert.match(h.store.getMemory("pet").body, /cat/);

    const out = await fetch(`${h.base}/logout`, { headers: H, redirect: "manual" });
    assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await fetch(`${h.base}/api/me`, { headers: H })).status, 401);
  } finally {
    h.close();
  }
});
