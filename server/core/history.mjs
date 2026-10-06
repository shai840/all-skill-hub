// Git history for the hub folder. Every write from an app or the web UI becomes a
// commit authored by that app, so the hub has a full, restorable history. If a
// remote is configured (a private GitHub repo), commits are pushed in batches.
// The per-memory `version` hash still guards concurrent writes; git is the record.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";

const SAFE_REV = /^[0-9a-f]{4,40}$/;

export function createHistory({ dir, remote = "", branch = "main", pushDelayMs = 30_000, log = () => {} }) {
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }).trim();
  let enabled = false;
  let pushTimer = null;

  function available() {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  function init() {
    if (!available()) {
      log("git not found; history disabled");
      return false;
    }
    fs.mkdirSync(dir, { recursive: true });
    const fresh = !fs.existsSync(path.join(dir, ".git"));
    if (fresh) {
      git("init", "-q", "-b", branch);
    }
    git("config", "user.name", "All-Skill Hub");
    git("config", "user.email", "hub@all-skill.local");
    const ignore = path.join(dir, ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, ".activity.jsonl\n.DS_Store\n");
    if (remote) {
      const remotes = git("remote").split("\n");
      if (remotes.includes("origin")) git("remote", "set-url", "origin", remote);
      else git("remote", "add", "origin", remote);
      try {
        git("fetch", "-q", "origin", branch);
        if (fresh) git("reset", "-q", "--soft", `origin/${branch}`); // adopt remote history, keep local files
      } catch {
        log("remote has no history yet; it will be created on first push");
      }
    }
    enabled = true;
    commit({ message: fresh ? "Initial import" : "Sync working tree", author: "All-Skill Hub" });
    return true;
  }

  function commit({ message, author = "unknown" }) {
    if (!enabled) return null;
    try {
      git("add", "-A");
      if (!git("status", "--porcelain")) return null;
      const name = String(author).replace(/[<>\n]/g, "").slice(0, 80) || "unknown";
      const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app"}@all-skill.local`;
      git("commit", "-q", "-m", String(message).slice(0, 500), "--author", `${name} <${email}>`);
      schedulePush();
      return git("rev-parse", "--short", "HEAD");
    } catch (e) {
      log(`commit failed: ${e.stderr || e.message}`);
      return null;
    }
  }

  function schedulePush() {
    if (!remote || pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      execFile("git", ["push", "-q", "origin", `HEAD:${branch}`], { cwd: dir, timeout: 60_000 }, (err, _o, stderr) => {
        if (err) log(`push failed: ${stderr || err.message}`);
      });
    }, pushDelayMs);
    pushTimer.unref?.();
  }

  function safePath(rel) {
    const full = path.resolve(dir, String(rel || ""));
    if (!full.startsWith(dir + path.sep)) throw Object.assign(new Error("path escapes the hub"), { userFacing: true });
    return path.relative(dir, full);
  }

  /** Commits that touched one file, newest first. */
  function fileLog(rel, limit = 50) {
    if (!enabled) return [];
    const out = git("log", `-n${limit}`, "--follow", "--format=%h%x1f%aI%x1f%an%x1f%s", "--", safePath(rel));
    return out
      ? out.split("\n").map((l) => {
          const [rev, date, author, message] = l.split("\x1f");
          return { rev, date, author, message };
        })
      : [];
  }

  /** Recent commits across the whole hub. */
  function recent(limit = 50) {
    if (!enabled) return [];
    const out = git("log", `-n${limit}`, "--format=%h%x1f%aI%x1f%an%x1f%s");
    return out ? out.split("\n").map((l) => Object.fromEntries(["rev", "date", "author", "message"].map((k, i) => [k, l.split("\x1f")[i]]))) : [];
  }

  function show(rel, rev) {
    if (!enabled) return null;
    if (!SAFE_REV.test(String(rev))) throw Object.assign(new Error("bad revision"), { userFacing: true });
    try {
      return git("show", `${rev}:${safePath(rel)}`);
    } catch {
      return null;
    }
  }

  /** Write a file back to how it was at `rev`, as a new commit. */
  function restore(rel, rev, author) {
    const content = show(rel, rev);
    if (content == null) throw Object.assign(new Error("That version doesn't exist"), { userFacing: true, status: 404 });
    const full = path.join(dir, safePath(rel));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content.endsWith("\n") ? content : content + "\n");
    return commit({ message: `Restore ${rel} to ${rev}`, author });
  }

  return {
    init,
    commit,
    fileLog,
    recent,
    show,
    restore,
    get enabled() {
      return enabled;
    },
    get remote() {
      return Boolean(remote);
    },
  };
}
