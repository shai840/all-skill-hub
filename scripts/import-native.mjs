// Snapshot native Markdown memories and user-installed skills into the hub.
// Run with --apply to write. Re-running is safe: existing hub skills win conflicts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../server/core/frontmatter.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hub = path.join(repo, "hub");
const home = os.homedir();
const apply = process.argv.includes("--apply");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const files = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === ".git" || e.isSymbolicLink()) return [];
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : e.isFile() ? [p] : [];
}) : [];
const rel = (base, p) => path.relative(base, p).split(path.sep).join("/");
const oldManifestPath = path.join(hub, "sources", "manifest.json");
const oldManifest = fs.existsSync(oldManifestPath) ? JSON.parse(fs.readFileSync(oldManifestPath, "utf8")) : { documents: [] };
const oldHashes = new Map(oldManifest.documents.map((d) => [d.path, d.sha256]));
const safeCopy = (from, to, previousHash) => {
  const bytes = fs.readFileSync(from);
  const existed = fs.existsSync(to);
  if (existed && sha(fs.readFileSync(to)) !== sha(bytes)) {
    if (previousHash && sha(fs.readFileSync(to)) === previousHash) {
      if (apply) fs.writeFileSync(to, bytes);
      return "updated";
    }
    return "conflict";
  }
  if (!existed && apply) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
  }
  return existed ? "present" : "new";
};

const documents = [];
const skills = [];
const conflicts = [];
const duplicateSources = [];
let newSkillFiles = 0;
const active = files(path.join(hub, "memories")).filter((p) => p.endsWith(".md"));
const activeNames = new Map(active.map((p) => [path.basename(p), p]));
const activeBodies = new Map(active.map((p) => [parseFrontmatter(fs.readFileSync(p, "utf8")).body.trim(), p]));

function addSource(origin, sourceRoot, sourceFile, searchable) {
  const name = rel(sourceRoot, sourceFile);
  const target = path.join(hub, "sources", origin, name);
  const documentPath = `${origin}/${name}`;
  const status = safeCopy(sourceFile, target, oldHashes.get(documentPath));
  const id = `${origin}/${name.replace(/\.md$/, "")}`;
  if (status === "conflict") conflicts.push({ kind: "source", id, source: sourceFile, target });
  documents.push({ id, path: documentPath, title: path.basename(name, ".md").replace(/[-_]/g, " "), origin: sourceFile,
    sha256: sha(fs.readFileSync(sourceFile)), searchable: status !== "conflict" && searchable });
}

const codexRoot = path.join(home, ".codex", "memories");
for (const p of files(codexRoot).filter((p) => p.endsWith(".md") && !p.includes(`${path.sep}skills${path.sep}`))) {
  const name = path.basename(p);
  // Raw extraction is retained for completeness, but the registry and per-run summaries
  // are better search results for the same material.
  addSource("codex", codexRoot, p, name !== "raw_memories.md" && !p.includes(`${path.sep}extensions${path.sep}`));
}

const claudeRoot = path.join(home, ".claude", "projects");
const claudeMemories = fs.existsSync(claudeRoot) ? fs.readdirSync(claudeRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
  .flatMap((e) => files(path.join(claudeRoot, e.name, "memory")).filter((p) => p.endsWith(".md"))) : [];
for (const p of claudeMemories) {
  const name = path.basename(p);
  const duplicate = name !== "MEMORY.md" && (activeNames.get(name) ||
    activeBodies.get(parseFrontmatter(fs.readFileSync(p, "utf8")).body.trim()));
  if (duplicate) duplicateSources.push({ origin: p, existing: rel(hub, duplicate) });
  const project = path.basename(path.dirname(path.dirname(p)));
  addSource(`claude/${project}`, path.dirname(p), p, name !== "MEMORY.md" && !duplicate);
}

const skillRoots = [
  path.join(home, ".codex", "skills"),
  path.join(home, ".codex", "memories", "skills"),
  path.join(home, ".agents", "skills"),
  path.join(home, ".codex", "plugins", "cache", "personal", "pj", "0.1.0", "skills"),
];
for (const root of skillRoots) {
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const source = path.join(root, entry.name);
    if (!fs.existsSync(path.join(source, "SKILL.md"))) continue;
    const target = path.join(hub, "skills", entry.name);
    const sourceFiles = files(source);
    for (const p of sourceFiles) {
      const dest = path.join(target, rel(source, p));
      const status = safeCopy(p, dest);
      if (status === "new") newSkillFiles++;
      else if (status === "conflict") conflicts.push({ kind: "skill", name: entry.name, file: rel(source, p), source: p, target: dest });
    }
    skills.push({ name: entry.name, origin: source, fileCount: sourceFiles.length });
  }
}

const manifest = { version: 1, generatedAt: oldManifest.generatedAt || new Date().toISOString(), documents, duplicateSources, skills, conflicts };
if (apply) {
  const target = path.join(hub, "sources", "manifest.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", documents: documents.length,
  searchable: documents.filter((d) => d.searchable).length, duplicateNativeMemories: duplicateSources.length,
  skillFolders: skills.length, newSkillFiles, conflicts }, null, 2));
