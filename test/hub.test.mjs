import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStore } from "../server/core/store.mjs";
import { startHttp } from "../server/http.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "all-skill-test-"));
  fs.cpSync(path.join(REPO, "templates", "hub", "skills"), path.join(dir, "skills"), { recursive: true });
  fs.writeFileSync(path.join(dir, "profile.md"), "# Who I am\n\n- Name: Test User\n");
  return dir;
}

/** Spawn the stdio server and talk JSON-RPC to it. */
function stdioClient(hubDir, clientName, extraArgs = [], env = {}) {
  const child = spawn(process.execPath, [path.join(REPO, "server", "index.mjs"), ...extraArgs], {
    env: { ...process.env, ALL_SKILL_HUB: hubDir, ALL_SKILL_NO_DAEMON: "1", ALL_SKILL_PORT: "1", ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  const waiting = new Map();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  const call = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result;
  const init = () => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: clientName, version: "1.0" } });
  return { rpc, call, init, close: () => child.stdin.end() };
}

const text = (r) => r.content.map((c) => c.text).join("\n");

test("store: memories round-trip in Claude's file format, scoped and searchable", () => {
  const store = createStore(tempHub());
  const a = store.saveMemory({ name: "Prefers TypeScript", description: "Likes TS over JS", type: "user", body: "Use TS. See [[coding-style]].", source: "test" });
  assert.equal(a.memory.id, "global/prefers-typescript");
  assert.deepEqual(a.unresolvedLinks, ["coding-style"]);
  const raw = fs.readFileSync(path.join(store.root, a.memory.file), "utf8");
  assert.match(raw, /^---\nname: prefers-typescript\ndescription: Likes TS over JS\nmetadata:\n  type: user\n/);

  store.saveMemory({ name: "deploy-target", description: "Deploys to Fly", type: "project", body: "Fly.io", project: "My App" });
  assert.equal(store.getMemory("deploy-target", "my-app").id, "my-app/deploy-target");
  assert.equal(store.getMemory("deploy-target"), null, "project memory is not global");
  assert.equal(store.listMemories({ project: "my-app", include: "context" }).length, 2);
  assert.equal(store.searchMemories("typescript")[0].name, "prefers-typescript");

  const again = store.saveMemory({ name: "prefers-typescript", description: "Updated", type: "user", body: "x" });
  assert.equal(again.created, false);
  assert.equal(again.memory.created, a.memory.created, "created timestamp survives updates");
  assert.throws(() => store.saveMemory({ name: "x", description: "d", type: "bogus", body: "" }), /type must be/);
});

test("store: skills by exact name, fuzzy name and topic; files stay inside the skill", () => {
  const store = createStore(tempHub());
  assert.equal(store.getSkill("Commit Message").name, "commit-message");
  assert.equal(store.getSkill("comit-mesage"), null);
  assert.equal(store.findSkills("comit-mesage")[0].name, "commit-message");
  assert.equal(store.findSkills("clean up my memories")[0].name, "memory-hygiene");
  assert.match(store.readSkillFile("memory-hygiene", "checklist.md").content, /Duplicates/);
  assert.throws(() => store.readSkillFile("memory-hygiene", "../../profile.md"), /escapes/);
});

test("imported sources are searchable evidence, while duplicate backups stay out of search", () => {
  const store = createStore(tempHub());
  const sourceDir = path.join(store.root, "sources", "codex");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "note.md"), "Past observation about a blue notebook.\n");
  fs.writeFileSync(path.join(sourceDir, "raw.md"), "Past observation about a blue notebook.\n");
  fs.writeFileSync(path.join(store.root, "sources", "manifest.json"), JSON.stringify({ documents: [
    { id: "codex/note", path: "codex/note.md", title: "Notebook note", searchable: true },
    { id: "codex/raw", path: "codex/raw.md", title: "Raw backup", searchable: false },
  ] }));
  assert.deepEqual(store.searchSources("notebook").map((d) => d.id), ["codex/note"]);
  assert.match(store.getSource("codex/raw").text, /blue notebook/);
  assert.equal(store.getSource("../profile"), null);
});

test("skill writes require the fetched version and keep supporting files", () => {
  const store = createStore(tempHub());
  const current = store.getSkill("commit-message");
  assert.throws(() => store.saveSkill({ name: current.name, description: current.description, body: "changed", version: "new" }), /changed/);
  const saved = store.saveSkill({ name: current.name, description: current.description, body: current.body,
    files: { "references/example.md": "Example" }, version: current.version });
  assert.notEqual(saved.skill.version, current.version);
  assert.equal(store.readSkillFile(current.name, "references/example.md").content, "Example");
});

test("stdio: Claude client gets the Claude adapter and Claude-shaped tools", async () => {
  const c = stdioClient(tempHub(), "claude-ai");
  try {
    const init = await c.init();
    assert.match(init.result.instructions, /MEMORY\.md/);
    const names = (await c.rpc("tools/list")).result.tools.map((t) => t.name);
    assert.ok(names.includes("memory_write") && names.includes("skill_get") && !names.includes("fetch"));

    const ctx = text(await c.call("get_context"));
    assert.match(ctx, /Test User/);
    assert.match(ctx, /- commit-message: Use when writing a git commit/);

    const saved = text(await c.call("memory_write", { name: "likes-tea", description: "Drinks tea", type: "user", body: "Green tea. [[morning-routine]]" }));
    assert.match(saved, /Saved new memory `global\/likes-tea`/);
    assert.match(saved, /\[\[morning-routine\]\]/);
    assert.match(text(await c.call("get_context")), /- \[likes-tea\]\(likes-tea\.md\) — Drinks tea/);

    const skill = text(await c.call("skill_get", { name: "memory-hygiene" }));
    assert.match(skill, /^Base directory for this skill: /);
    assert.match(skill, /checklist\.md/);
    assert.match(text(await c.call("skill_get", { name: "comit-mesage" })), /Did you mean: commit-message/);
    assert.match(text(await c.call("skill_read_file", { name: "memory-hygiene", path: "checklist.md" })), /Duplicates/);

    const bad = await c.call("memory_write", { name: "x", description: "d", type: "nope", body: "" });
    assert.equal(bad.isError, true);
  } finally {
    c.close();
  }
});

test("stdio: --client forces an adapter regardless of clientInfo", async () => {
  const c = stdioClient(tempHub(), "some-other-app", ["--client", "chatgpt"]);
  try {
    await c.init();
    const names = (await c.rpc("tools/list")).result.tools.map((t) => t.name);
    assert.ok(names.includes("search") && names.includes("fetch"));
  } finally {
    c.close();
  }
});

test("http: ChatGPT gets search/fetch in OpenAI's shape, and writes are visible to Claude", async () => {
  const hub = tempHub();
  const store = createStore(hub);
  const server = await startHttp({ store, port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (pathName, body, headers = {}) => {
    const r = await fetch(base + pathName, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
    return { status: r.status, sid: r.headers.get("mcp-session-id"), json: r.status === 202 ? null : await r.json() };
  };
  try {
    const init = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "openai-mcp", version: "1" } } });
    assert.ok(init.sid);
    const h = { "mcp-session-id": init.sid };
    assert.equal((await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, h)).status, 202);

    const tools = (await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, h)).json.result.tools;
    assert.ok(tools.find((t) => t.name === "search").annotations.readOnlyHint);

    const save = await post("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "save_memory", arguments: { name: "uses-linear", description: "Tracks work in Linear", type: "reference", content: "Linear workspace: acme" } } }, h);
    const sc = save.json.result.structuredContent;
    assert.deepEqual([sc.ok, sc.id, sc.created], [true, "memory:global/uses-linear", true]);

    const search = await post("/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search", arguments: { query: "linear" } } }, h);
    const results = JSON.parse(search.json.result.content[0].text).results;
    assert.deepEqual(Object.keys(results[0]).sort(), ["id", "title", "url"]);
    const doc = await post("/mcp", { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fetch", arguments: { id: "memory:global/uses-linear" } } }, h);
    assert.equal(doc.json.result.structuredContent.text.trim(), "Linear workspace: acme");

    // The same fact, seen through the Claude adapter.
    const c = await post("/mcp/claude", { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "memory_read", arguments: { name: "uses-linear" } } });
    assert.match(c.json.result.content[0].text, /created_by: openai-mcp via chatgpt/);

    assert.equal((await post("/mcp", { jsonrpc: "2.0", id: 7, method: "tools/list" }, { "mcp-session-id": "stale" })).status, 404);
    assert.equal((await post("/mcp", { jsonrpc: "2.0", id: 8, method: "tools/list" }, { origin: "https://evil.example" })).status, 403);

    const overview = await (await fetch(base + "/api/overview")).json();
    assert.ok(overview.clients.some((x) => x.client === "openai-mcp" && x.adapter === "chatgpt"));
    const html = await (await fetch(base + "/")).text();
    assert.match(html, /All-Skill Hub/);
  } finally {
    server.close();
  }
});

test("http api: web UI can create, rename-move and delete a memory", async () => {
  const store = createStore(tempHub());
  const server = await startHttp({ store, port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (p, method = "GET", body) => fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());
  try {
    const a = await j("/api/memory", "PUT", { name: "draft", description: "d", type: "user", body: "b" });
    assert.equal(a.memory.id, "global/draft");
    const b = await j("/api/memory", "PUT", { originalId: "global/draft", name: "final", description: "d", type: "project", body: "b", project: "proj" });
    assert.equal(b.memory.id, "proj/final");
    assert.equal(store.getMemory("global/draft"), null);
    assert.equal((await j("/api/memory?id=proj%2Ffinal", "DELETE")).deleted, "proj/final");
    const prev = await j("/api/preview", "POST", { adapter: "claude", tool: "memory_write", args: {} });
    assert.match(prev.error, /read-only/);
  } finally {
    server.close();
  }
});

test("writes are versioned: no silent overwrite across apps, conflicts return the current text", async () => {
  const hub = tempHub();
  fs.writeFileSync(path.join(hub, "policy.md"), "# Saving policy\n\nNever save passwords.\n");
  const claude = stdioClient(hub, "claude-ai");
  const gpt = stdioClient(hub, "openai-mcp");
  try {
    await claude.init();
    await gpt.init();
    assert.match(text(await claude.call("get_context")), /Saving policy[\s\S]*Never save passwords/);

    assert.match(text(await claude.call("memory_write", { name: "editor", description: "Uses VS Code", type: "user", body: "VS Code" })), /Saved new/);
    const blind = await gpt.call("save_memory", { name: "editor", description: "Uses Cursor", type: "user", content: "Cursor" });
    assert.equal(blind.isError, true);
    assert.match(text(blind), /already exists \(version (\w+)\)[\s\S]*VS Code/);

    const fetched = (await gpt.call("fetch", { id: "memory:global/editor" })).structuredContent;
    const v1 = fetched.metadata.version;
    const ok = await gpt.call("save_memory", { name: "editor", description: "Uses VS Code and Cursor", type: "user", content: "VS Code and Cursor", version: v1 });
    assert.equal(ok.structuredContent.ok, true);

    const stale = await claude.call("memory_write", { name: "editor", description: "x", type: "user", body: "x", version: v1 });
    assert.equal(stale.isError, true);
    assert.match(text(stale), /Cursor/);

    const read = text(await claude.call("memory_read", { name: "editor" }));
    assert.match(read, /created_by: claude-ai via claude/);
    assert.match(read, /updated_by: openai-mcp via chatgpt/);
    const v2 = read.match(/Version: (\w+)/)[1];
    assert.match(text(await claude.call("memory_write", { name: "editor", description: "Uses Cursor", type: "user", body: "Cursor", version: v2 })), /Updated memory/);
  } finally {
    claude.close();
    gpt.close();
  }
});

test("frontmatter: folded and literal block scalars (as used by imported Claude skills)", async () => {
  const { parseFrontmatter } = await import("../server/core/frontmatter.mjs");
  const { meta, body } = parseFrontmatter("---\nname: chaser\ndescription: >\n  Use this skill whenever\n  the user wants Chaser.\nnotes: |\n  line one\n  line two\nmetadata:\n  type: user\n---\n\nBody");
  assert.equal(meta.description, "Use this skill whenever the user wants Chaser.");
  assert.equal(meta.notes, "line one\nline two");
  assert.deepEqual(meta.metadata, { type: "user" });
  assert.equal(body.trim(), "Body");
});

test("stdio proxies to a running hub of the same folder and survives a hub restart", async () => {
  const hub = tempHub();
  const store = createStore(hub);
  let server = await startHttp({ store, port: 0 });
  const port = server.address().port;
  const c = stdioClient(hub, "claude-ai", [], { ALL_SKILL_PORT: String(port) });
  try {
    await c.init();
    assert.match(text(await c.call("memory_write", { name: "via-proxy", description: "d", type: "user", body: "b" })), /Saved new/);
    await new Promise((r) => server.close(r));
    server = await startHttp({ store: createStore(hub), port }); // new process state: sessions forgotten
    assert.match(text(await c.call("memory_read", { name: "via-proxy" })), /Version: /);
    const transports = store.readActivity().filter((a) => a.event === "connect").map((a) => a.transport);
    assert.ok(transports.length >= 2 && transports.every((t) => t === "stdio-proxy"), transports.join());
  } finally {
    c.close();
    server.close();
  }
});

test("stdio does not proxy to a hub serving a different folder", async () => {
  const other = await startHttp({ store: createStore(tempHub()), port: 0 });
  const hub = tempHub();
  const c = stdioClient(hub, "claude-ai", [], { ALL_SKILL_PORT: String(other.address().port) });
  try {
    await c.init();
    await c.call("memory_write", { name: "isolated", description: "d", type: "user", body: "b" });
    assert.ok(createStore(hub).getMemory("isolated"));
  } finally {
    c.close();
    other.close();
  }
});

test("store: re-saving a skill with a folded description keeps the description text", () => {
  const store = createStore(tempHub());
  fs.mkdirSync(path.join(store.root, "skills", "folded"));
  fs.writeFileSync(path.join(store.root, "skills", "folded", "SKILL.md"), "---\nname: folded\ndescription: >\n  Use when the user\n  wants folding.\n---\n\nSteps.\n");
  const s = store.getSkill("folded");
  assert.equal(s.description, "Use when the user wants folding.");
  store.saveSkill({ name: s.name, description: s.description, body: s.body });
  assert.equal(store.getSkill("folded").description, "Use when the user wants folding.");
});

test("get_context without a project lists every project's memory index (chats have no project)", async () => {
  const store = createStore(tempHub());
  store.saveMemory({ name: "listing-sync", description: "Acme listings sync nightly from the CRM", type: "project", body: "x", project: "acme" });
  const { renderContext } = await import("../server/adapters/claude.mjs");
  const all = renderContext(store, null);
  assert.match(all, /MEMORY\.md — project `acme` \(1\)[\s\S]*listing-sync.*CRM/);
  const scoped = renderContext(store, "other");
  assert.match(scoped, /Other projects with memories: acme/);
  assert.doesNotMatch(scoped, /listing-sync/);
});

test("a correction saved under a new name is caught as a near-duplicate; confirm_new overrides", async () => {
  const c = stdioClient(tempHub(), "claude-ai");
  try {
    await c.init();
    await c.call("memory_write", { name: "deliverables-in-notion", description: "All client deliverables go out as Notion pages, not Google Docs", type: "feedback", body: "Notion." });
    const dup = await c.call("memory_write", { name: "deliverable-destination", description: "Internal deliverables in Notion; client deliverables can be Google Docs", type: "feedback", body: "Correction." });
    assert.equal(dup.isError, true);
    assert.match(text(dup), /looks like the existing memory "global\/deliverables-in-notion" \(version \w+\)[\s\S]*All client deliverables/);
    const distinct = await c.call("memory_write", { name: "prefers-dark-mode", description: "Prefers dark mode in every app", type: "user", body: "Dark." });
    assert.match(text(distinct), /Saved new/);
    const forced = await c.call("memory_write", { name: "deliverable-destination", description: "Internal deliverables in Notion; client deliverables can be Google Docs", type: "feedback", body: "x", confirm_new: true });
    assert.match(text(forced), /Saved new/);
  } finally {
    c.close();
  }
});

test("apps can update the profile with its version; stale versions are refused", async () => {
  const c = stdioClient(tempHub(), "claude-ai");
  try {
    await c.init();
    const v = text(await c.call("get_context")).match(/User profile _\(version (\w+)\)_/)[1];
    assert.match(text(await c.call("profile_update", { text: "# Who I am\n\n- Alex, Acme\n", version: v })), /Updated the profile/);
    assert.match(text(await c.call("get_context")), /Alex, Acme/);
    const stale = await c.call("profile_update", { text: "# overwrite", version: v });
    assert.equal(stale.isError, true);
    assert.match(text(stale), /changed since you read it[\s\S]*Alex, Acme/);
  } finally {
    c.close();
  }
});
