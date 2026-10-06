// OAuth 2.1 for the hosted hub, bridged to Google sign-in (the same "OAuth proxy"
// pattern FastMCP uses). The hub is its own authorization server for MCP clients
// (Claude, ChatGPT): they discover it via RFC 9728/8414 metadata, register with
// RFC 7591 dynamic client registration, and use authorization code + PKCE (S256).
// The user proves who they are by signing in with Google; only allowlisted
// verified emails get tokens. The web UI uses the same Google sign-in with a cookie.
//
// Only hashes of tokens are stored. Pending logins and codes live in memory.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ACCESS_TTL = 60 * 60 * 1000; // 1h
const REFRESH_TTL = 90 * 24 * 60 * 60 * 1000; // 90d, rotated on use
const WEB_TTL = 30 * 24 * 60 * 60 * 1000; // 30d
const PENDING_TTL = 10 * 60 * 1000;
const CODE_TTL = 2 * 60 * 1000;
export const COOKIE = "allskill_session";

const rand = (n = 32) => randomBytes(n).toString("base64url");
const sha = (s) => createHash("sha256").update(String(s)).digest("base64url");

function oauthError(status, error, description) {
  return Object.assign(new Error(description || error), { status, oauth: { error, error_description: description } });
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || "").split(".")[1];
  if (!part) throw oauthError(502, "server_error", "Google returned no ID token");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function parseCookies(header) {
  const out = {};
  for (const p of String(header || "").split(/;\s*/)) {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.baseUrl        public origin, e.g. https://hub.up.railway.app
 * @param {string} o.stateFile      JSON file for client registrations + token hashes
 * @param {{clientId:string, clientSecret:string, authUrl?:string, tokenUrl?:string}} o.google
 * @param {string[]} o.allowedEmails
 * @param {string} [o.allowedDomain]
 */
export function createAuth({ baseUrl, stateFile, google, allowedEmails = [], allowedDomain = "", fetchImpl = fetch }) {
  const G = {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    ...google,
  };
  const callbackUrl = `${baseUrl}/auth/callback`;
  const emails = allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const domain = allowedDomain.trim().toLowerCase().replace(/^@/, "");

  // ---------- persisted state ----------
  let state = { clients: {}, tokens: {} };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
  } catch {}
  const save = () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  };
  function prune() {
    const now = Date.now();
    for (const [k, t] of Object.entries(state.tokens)) if (t.exp < now) delete state.tokens[k];
  }

  const pending = new Map(); // google state -> login transaction
  const codes = new Map(); // our auth code hash -> grant

  function issue(type, ttl, data) {
    const token = rand();
    state.tokens[sha(token)] = { type, exp: Date.now() + ttl, ...data };
    return token;
  }

  function emailAllowed(email) {
    const e = String(email || "").toLowerCase();
    return Boolean(e) && (emails.includes(e) || (domain && e.endsWith(`@${domain}`)));
  }

  // ---------- metadata ----------

  function authServerMetadata() {
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      revocation_endpoint: `${baseUrl}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: ["hub"],
      client_id_metadata_document_supported: false,
    };
  }

  function resourceMetadata(resourcePath = "/mcp") {
    return {
      resource: `${baseUrl}${resourcePath}`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["hub"],
      resource_name: "All-Skill Hub",
    };
  }

  const challenge = (resourcePath = "/mcp") =>
    `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource${resourcePath}"`;

  // ---------- dynamic client registration ----------

  function register(body) {
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string") : [];
    if (!uris.length) throw oauthError(400, "invalid_redirect_uri", "redirect_uris is required");
    for (const u of uris) {
      let p;
      try {
        p = new URL(u);
      } catch {
        throw oauthError(400, "invalid_redirect_uri", `Invalid redirect URI: ${u}`);
      }
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(p.hostname);
      // https anywhere; http only on loopback; native-app custom schemes (e.g. cursor://) allowed.
      if (["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(p.protocol) || (p.protocol === "http:" && !loopback))
        throw oauthError(400, "invalid_redirect_uri", `Redirect URI must be https, loopback http, or an app scheme: ${u}`);
    }
    const method = body.token_endpoint_auth_method || "none";
    const client = {
      client_id: `c_${rand(16)}`,
      client_name: String(body.client_name || "MCP client").slice(0, 100),
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    const stored = { ...client };
    if (method !== "none") {
      const secret = rand();
      client.client_secret = secret;
      client.client_secret_expires_at = 0;
      stored.secret_hash = sha(secret);
    }
    state.clients[client.client_id] = stored;
    save();
    return client;
  }

  // ---------- authorize → Google ----------

  function googleRedirect(tx) {
    const gState = rand();
    const verifier = rand(48);
    pending.set(gState, { ...tx, verifier, at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL) pending.delete(k);
    const u = new URL(G.authUrl);
    u.search = new URLSearchParams({
      client_id: G.clientId,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "openid email",
      state: gState,
      code_challenge: sha(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
      access_type: "online",
    }).toString();
    return u.toString();
  }

  /** Validates the MCP client's request; returns the Google URL to send the browser to. */
  function authorize(q) {
    const client = state.clients[q.client_id];
    if (!client) throw oauthError(400, "invalid_client", "Unknown client_id; register first");
    if (!client.redirect_uris.includes(q.redirect_uri)) throw oauthError(400, "invalid_request", "redirect_uri is not registered for this client");
    if (q.response_type !== "code") throw oauthError(400, "unsupported_response_type", "Only response_type=code is supported");
    if (!q.code_challenge || q.code_challenge_method !== "S256") throw oauthError(400, "invalid_request", "PKCE with S256 is required");
    return googleRedirect({
      kind: "mcp",
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      state: q.state || "",
      code_challenge: q.code_challenge,
      scope: q.scope || "hub",
      resource: q.resource || "",
    });
  }

  const webLogin = (returnTo = "/") => {
    const target = String(returnTo);
    return googleRedirect({ kind: "web", returnTo: target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\") ? target : "/" });
  };

  /** Google sends the browser back here. Returns { redirect, cookie? } or throws. */
  async function callback(q) {
    const tx = pending.get(q.state);
    pending.delete(q.state);
    if (!tx) throw oauthError(400, "invalid_request", "This sign-in link expired. Start again from your app.");
    if (q.error) throw oauthError(403, "access_denied", `Google sign-in failed: ${q.error}`);

    const r = await fetchImpl(G.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: q.code,
        client_id: G.clientId,
        client_secret: G.clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
        code_verifier: tx.verifier,
      }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok) throw oauthError(502, "server_error", `Google token exchange failed: ${tok.error_description || tok.error || r.status}`);
    // The ID token came straight from Google's token endpoint over TLS, so its claims
    // can be trusted without a signature check (OIDC Core §3.1.3.7); still check aud/iss.
    const claims = decodeJwtPayload(tok.id_token);
    if (claims.aud !== G.clientId) throw oauthError(403, "access_denied", "ID token audience mismatch");
    if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) throw oauthError(403, "access_denied", "ID token issuer mismatch");
    if (!claims.email_verified || !emailAllowed(claims.email))
      throw oauthError(403, "access_denied", `${claims.email || "This account"} is not allowed to use this hub.`);
    const email = String(claims.email).toLowerCase();

    if (tx.kind === "web") {
      prune();
      const session = issue("web", WEB_TTL, { email });
      save();
      return { redirect: tx.returnTo, cookie: session, email };
    }
    const code = rand();
    codes.set(sha(code), { ...tx, email, at: Date.now() });
    const back = new URL(tx.redirect_uri);
    back.searchParams.set("code", code);
    if (tx.state) back.searchParams.set("state", tx.state);
    back.searchParams.set("iss", baseUrl);
    return { redirect: back.toString(), email };
  }

  // ---------- token endpoint ----------

  function authenticateClient(body, authHeader) {
    let id = body.client_id;
    let secret = body.client_secret;
    const basic = String(authHeader || "").match(/^Basic\s+(.+)$/i);
    if (basic) {
      const [u, p] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
      id = decodeURIComponent(u || "");
      secret = decodeURIComponent(p || "");
    }
    const client = state.clients[id];
    if (!client) throw oauthError(401, "invalid_client", "Unknown client");
    if (client.secret_hash) {
      const a = Buffer.from(sha(secret || ""));
      const b = Buffer.from(client.secret_hash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw oauthError(401, "invalid_client", "Bad client credentials");
    }
    return client;
  }

  function tokenPair(client_id, email, scope) {
    prune();
    const access = issue("access", ACCESS_TTL, { client_id, email, scope });
    const refresh = issue("refresh", REFRESH_TTL, { client_id, email, scope });
    save();
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope };
  }

  function token(body, authHeader) {
    const client = authenticateClient(body, authHeader);
    if (body.grant_type === "authorization_code") {
      const grant = codes.get(sha(body.code));
      codes.delete(sha(body.code));
      if (!grant || Date.now() - grant.at > CODE_TTL) throw oauthError(400, "invalid_grant", "Authorization code is invalid or expired");
      if (grant.client_id !== client.client_id) throw oauthError(400, "invalid_grant", "Code was issued to another client");
      if (body.redirect_uri && body.redirect_uri !== grant.redirect_uri) throw oauthError(400, "invalid_grant", "redirect_uri mismatch");
      if (!body.code_verifier || sha(body.code_verifier) !== grant.code_challenge) throw oauthError(400, "invalid_grant", "PKCE verification failed");
      return tokenPair(client.client_id, grant.email, grant.scope);
    }
    if (body.grant_type === "refresh_token") {
      const key = sha(body.refresh_token);
      const t = state.tokens[key];
      if (!t || t.type !== "refresh" || t.exp < Date.now() || t.client_id !== client.client_id) throw oauthError(400, "invalid_grant", "Refresh token is invalid or expired");
      delete state.tokens[key]; // rotate
      if (!emailAllowed(t.email)) throw oauthError(400, "invalid_grant", "Account is no longer allowed");
      return tokenPair(client.client_id, t.email, t.scope);
    }
    throw oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  function revoke(body) {
    if (body.token && state.tokens[sha(body.token)]) {
      delete state.tokens[sha(body.token)];
      save();
    }
  }

  // ---------- request checks ----------

  function lookup(tokenValue, type) {
    const t = state.tokens[sha(tokenValue)];
    if (!t || t.type !== type || t.exp < Date.now() || !emailAllowed(t.email)) return null;
    return t;
  }

  /** Returns { email, client_id } for a valid bearer token, else null. */
  function verifyBearer(req) {
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    return m ? lookup(m[1].trim(), "access") : null;
  }

  function verifyCookie(req) {
    const c = parseCookies(req.headers.cookie)[COOKIE];
    return c ? lookup(c, "web") : null;
  }

  function logout(req) {
    const c = parseCookies(req.headers.cookie)[COOKIE];
    if (c && state.tokens[sha(c)]) {
      delete state.tokens[sha(c)];
      save();
    }
  }

  return {
    baseUrl,
    callbackUrl,
    authServerMetadata,
    resourceMetadata,
    challenge,
    register,
    authorize,
    webLogin,
    callback,
    token,
    revoke,
    verifyBearer,
    verifyCookie,
    logout,
    emailAllowed,
  };
}
