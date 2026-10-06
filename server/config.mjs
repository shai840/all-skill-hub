import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PUBLIC_DOMAIN);

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HUB_DIR = path.resolve(env.ALL_SKILL_HUB || path.join(REPO_DIR, "hub"));
export const WEB_DIR = path.join(REPO_DIR, "web");
export const HOST = env.ALL_SKILL_HOST || (onRailway ? "0.0.0.0" : "127.0.0.1");
export const PORT = Number(env.ALL_SKILL_PORT || env.PORT || 4747);
export const BASE_URL = (
  env.ALL_SKILL_BASE_URL ||
  env.MCP_AUTH_BASE_URL ||
  (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`)
).replace(/\/$/, "");

// Starter hub copied into an empty hub folder on first boot (local or hosted).
export const SEED_DIR = env.ALL_SKILL_SEED || path.join(REPO_DIR, "templates", "hub");

// Git history of the hub folder. On by default when hosted; DATA_REPO_URL adds a remote backup.
export const HISTORY = {
  enabled: env.ALL_SKILL_HISTORY ? env.ALL_SKILL_HISTORY !== "0" : onRailway,
  remote: env.DATA_REPO_URL || "",
  branch: env.DATA_REPO_BRANCH || "main",
};

// Google sign-in. Variable names match the Google Workspace MCP deployment so the
// same OAuth client can be reused.
export const AUTH = {
  enabled: Boolean(env.MCP_AUTH_GOOGLE_CLIENT_ID && env.MCP_AUTH_GOOGLE_CLIENT_SECRET),
  required: onRailway, // never serve the hub publicly without sign-in
  google: { clientId: env.MCP_AUTH_GOOGLE_CLIENT_ID, clientSecret: env.MCP_AUTH_GOOGLE_CLIENT_SECRET },
  allowedEmails: (env.AUTH_ALLOWED_EMAILS || "").split(",").filter(Boolean),
  allowedDomain: env.AUTH_ALLOWED_DOMAIN || "",
  stateFile: path.resolve(env.ALL_SKILL_AUTH_FILE || path.join(path.dirname(HUB_DIR), "auth-state.json")),
};
