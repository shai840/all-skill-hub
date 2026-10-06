// The hub's core: plain Markdown files on disk. Every client adapter and the web UI
// go through this module; nothing here knows which AI app is asking.
//
//   hub/profile.md                         who the user is (human-curated)
//   hub/policy.md                          what may be saved (applied by every app at write time)
//   hub/memories/global/<name>.md          memories that apply everywhere
//   hub/memories/projects/<proj>/<name>.md memories scoped to one project
//   hub/skills/<name>/SKILL.md (+ files)   skills in the shared SKILL.md format
//   hub/.activity.jsonl                    connection + tool-call log (not content)

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.mjs";

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const LINK_RE = /\[\[([^\]]+)\]\]/g;
const MAX_FILE_BYTES = 512 * 1024;

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function terms(query) {
  return String(query ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
}

function snippet(text, query, len = 160) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const t = terms(query).find((x) => flat.toLowerCase().includes(x));
  const at = t ? Math.max(0, flat.toLowerCase().indexOf(t) - 40) : 0;
  return (at > 0 ? "…" : "") + flat.slice(at, at + len) + (at + len < flat.length ? "…" : "");
}

function fail(message) {
  const e = new Error(message);
  e.userFacing = true;
  throw e;
}

export function createStore(root) {
  const P = {
    root,
    profile: path.join(root, "profile.md"),
    policy: path.join(root, "policy.md"),
    global: path.join(root, "memories", "global"),
    projects: path.join(root, "memories", "projects"),
    skills: path.join(root, "skills"),
    sources: path.join(root, "sources"),
    activity: path.join(root, ".activity.jsonl"),
  };
  for (const d of [P.global, P.projects, P.skills, P.sources]) fs.mkdirSync(d, { recursive: true });

  // Imported native memories are source documents, not automatically active facts.
  // The manifest keeps provenance and lets search omit duplicate or raw backups.
  function listSources() {
    const manifest = path.join(P.sources, "manifest.json");
    if (!fs.existsSync(manifest)) return [];
    const docs = JSON.parse(fs.readFileSync(manifest, "utf8")).documents || [];
    return docs.filter((d) => typeof d.id === "string" && typeof d.path === "string");
  }

  function getSource(id) {
    const doc = listSources().find((d) => d.id === id);
    if (!doc) return null;
    const file = path.resolve(P.sources, doc.path);
    if (!file.startsWith(P.sources + path.sep) || !fs.existsSync(file)) return null;
    if (fs.statSync(file).size > MAX_FILE_BYTES) fail("source document is too large to return");
    return { ...doc, text: fs.readFileSync(file, "utf8") };
  }

  function searchSources(query, limit = 8) {
    const ts = terms(query).filter((t) => t.length > 1);
    if (!ts.length) return [];
    return listSources().filter((d) => d.searchable).map((d) => {
      const file = path.resolve(P.sources, d.path);
      if (!file.startsWith(P.sources + path.sep) || !fs.existsSync(file)) return null;
      const body = fs.readFileSync(file, "utf8").toLowerCase();
      const title = `${d.title || ""} ${d.id}`.toLowerCase();
      let score = 0;
      for (const t of ts) score += (title.includes(t) ? 3 : 0) + (body.includes(t) ? 1 : 0);
      return score ? { ...d, score } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }

  // ---------- memories ----------

  const memDir = (project) => (project ? path.join(P.projects, slugify(project)) : P.global);

  function loadMemory(file, project) {
    const text = fs.readFileSync(file, "utf8");
    const { meta, body } = parseFrontmatter(text);
    const md = meta.metadata && typeof meta.metadata === "object" ? meta.metadata : {};
    const name = path.basename(file, ".md");
    return {
      id: `${project || "global"}/${name}`,
      name,
      description: meta.description || "",
      type: md.type || meta.type || "",
      scope: project ? "project" : "global",
      project: project || null,
      body: body.replace(/^\s*\n/, ""),
      links: [...new Set([...body.matchAll(LINK_RE)].map((m) => slugify(m[1])))],
      version: createHash("sha1").update(text).digest("hex").slice(0, 10),
      createdBy: md.created_by || md.source || meta.source || "",
      source: md.updated_by || md.source || meta.source || "",
      created: md.created || meta.created || "",
      updated: md.updated || meta.updated || fs.statSync(file).mtime.toISOString(),
      file: path.relative(root, file),
      text,
    };
  }

  function readMemDir(dir, project) {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => loadMemory(path.join(dir, f), project));
  }

  function listProjects() {
    return fs
      .readdirSync(P.projects, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }

  /** include: "all" | "global" | "project" (only `project`) | "context" (global + `project`) */
  function listMemories({ project = null, include = "all" } = {}) {
    const proj = project ? slugify(project) : null;
    let out = [];
    if (include !== "project") out = readMemDir(P.global, null);
    if (include === "all") for (const p of listProjects()) out.push(...readMemDir(path.join(P.projects, p), p));
    else if (proj) out.push(...readMemDir(path.join(P.projects, proj), proj));
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  function parseRef(ref, project) {
    const s = String(ref ?? "").replace(/\.md$/, "");
    const i = s.lastIndexOf("/");
    if (i > 0) {
      const scope = s.slice(0, i);
      return { explicit: true, project: scope === "global" ? null : slugify(scope), name: slugify(s.slice(i + 1)) };
    }
    return { explicit: false, project: project ? slugify(project) : null, name: slugify(s) };
  }

  /** Accepts "name", "global/name" or "<project>/name". Bare names check `project` first, then global. */
  function getMemory(ref, project = null) {
    const r = parseRef(ref, project);
    const candidates = r.explicit ? [r.project] : r.project ? [r.project, null] : [null];
    for (const p of candidates) {
      const file = path.join(memDir(p), `${r.name}.md`);
      if (fs.existsSync(file)) return loadMemory(file, p);
    }
    return null;
  }

  /**
   * version: undefined = no check (internal use); "new" = create only;
   * otherwise must equal the current version (optimistic concurrency).
   * Conflicts throw with status 409 and carry the current memory.
   */
  // ---------- near-duplicate detection ----------
  // Apps tend to save a correction as a *new* memory under a new name. Before creating
  // one, compare its name + description against the same scope; a close match is
  // rejected so the app updates the existing memory instead (or confirms it's distinct).

  const STOP = new Set("the and for with that this from into are was were has have will can still should use uses used when what which about over under than then they them their there here also just only more most very much such each other your yours user users his her its our out not but all any".split(" "));
  const keyTerms = (s) =>
    new Set(
      String(s ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map((w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, ""))
    );

  function findSimilarMemories({ name, description, project = null }, { exclude = null, threshold = 0.4 } = {}) {
    const a = keyTerms(`${String(name).replace(/-/g, " ")} ${description}`);
    if (a.size < 2) return [];
    return listMemories({ project, include: project ? "project" : "global" })
      .filter((m) => m.id !== exclude)
      .map((m) => {
        const b = keyTerms(`${m.name.replace(/-/g, " ")} ${m.description}`);
        const shared = [...a].filter((t) => b.has(t)).length;
        // Overlap coefficient: a short new description fully inside a longer old one still counts.
        return { memory: m, score: shared / Math.min(a.size, b.size || 1), shared };
      })
      .filter((x) => x.shared >= 2 && x.score >= threshold)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3);
  }

  function saveMemory({ name, description, type, body, project = null, source = "", version, confirmNew = true }) {
    const slug = slugify(name);
    if (!slug) fail("name must contain letters or numbers");
    if (!MEMORY_TYPES.includes(type)) fail(`type must be one of: ${MEMORY_TYPES.join(", ")}`);
    if (!String(description ?? "").trim()) fail("description is required");
    const proj = project ? slugify(project) : null;
    const dir = memDir(proj);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slug}.md`);
    const prev = fs.existsSync(file) ? loadMemory(file, proj) : null;
    if (version !== undefined) {
      const ok = prev ? version === prev.version : !version || version === "new";
      if (!ok) {
        const e = new Error(
          prev
            ? `Memory "${prev.id}" already exists (version ${prev.version}) and was not overwritten.`
            : `Memory "${proj || "global"}/${slug}" no longer exists; save it with version "new" to recreate it.`
        );
        Object.assign(e, { userFacing: true, status: 409, conflict: true, current: prev });
        throw e;
      }
    }
    if (!prev && !confirmNew) {
      const similar = findSimilarMemories({ name: slug, description, project: proj });
      if (similar.length) {
        const top = similar[0].memory;
        const e = new Error(
          `Not saved: this looks like the existing memory "${top.id}" (version ${top.version}). If you're correcting or extending it, update that memory instead (same name, pass its version). If it's genuinely a separate fact, save again with confirm_new: true.`
        );
        Object.assign(e, { userFacing: true, status: 409, conflict: true, duplicate: true, current: top, similar: similar.map((x) => x.memory.id) });
        throw e;
      }
    }
    const now = new Date().toISOString();
    fs.writeFileSync(
      file,
      serializeFrontmatter(
        {
          name: slug,
          description: String(description).trim(),
          metadata: {
            type,
            created_by: prev?.createdBy || source,
            updated_by: source || prev?.source,
            created: prev?.created || now,
            updated: now,
          },
        },
        body
      )
    );
    const memory = loadMemory(file, proj);
    const known = new Set(listMemories().map((m) => m.name));
    return { memory, created: !prev, unresolvedLinks: memory.links.filter((l) => !known.has(l)) };
  }

  function deleteMemory(ref, project = null) {
    const m = getMemory(ref, project);
    if (!m) return null;
    fs.unlinkSync(path.join(root, m.file));
    if (m.project) {
      const dir = memDir(m.project);
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    }
    return m;
  }

  function backlinks(name) {
    return listMemories()
      .filter((m) => m.name !== name && m.links.includes(name))
      .map((m) => m.id);
  }

  function searchMemories(query, { project = null, include = "all", limit = 10 } = {}) {
    const ts = terms(query);
    if (!ts.length) return [];
    return listMemories({ project, include })
      .map((m) => {
        const name = m.name.toLowerCase();
        const desc = m.description.toLowerCase();
        const body = m.body.toLowerCase();
        let score = 0;
        for (const t of ts) score += (name.includes(t) ? 3 : 0) + (desc.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0);
        return { ...m, score, snippet: snippet(m.body, query) };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || b.updated.localeCompare(a.updated))
      .slice(0, limit);
  }

  // ---------- profile ----------

  const getProfile = () => (fs.existsSync(P.profile) ? fs.readFileSync(P.profile, "utf8") : "");
  const profileVersion = () => createHash("sha1").update(getProfile()).digest("hex").slice(0, 10);
  /** version: undefined = no check (web UI); otherwise must match profileVersion(). */
  function saveProfile(text, { version } = {}) {
    if (version !== undefined && version !== profileVersion()) {
      const e = new Error(`The profile changed since you read it (now version ${profileVersion()}) and was not overwritten.`);
      Object.assign(e, { userFacing: true, status: 409, conflict: true, current: { version: profileVersion(), text: getProfile(), source: "", updated: "" } });
      throw e;
    }
    if (!String(text ?? "").trim()) fail("profile text is required");
    fs.writeFileSync(P.profile, String(text ?? "").trimEnd() + "\n");
    return getProfile();
  }

  // The saving policy travels with the hub so every app applies the same rules at write time.
  const getPolicy = () => (fs.existsSync(P.policy) ? fs.readFileSync(P.policy, "utf8") : "");
  function savePolicy(text) {
    fs.writeFileSync(P.policy, String(text ?? "").trimEnd() + "\n");
    return getPolicy();
  }

  // ---------- skills ----------

  function skillFiles(dir) {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (out.length < 200) out.push(path.relative(dir, full));
      }
    };
    walk(dir);
    return out.filter((f) => f !== "SKILL.md").sort();
  }

  function loadSkill(dirName) {
    const dir = path.join(P.skills, dirName);
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, "utf8");
    const { meta, body } = parseFrontmatter(text);
    const supportingFiles = skillFiles(dir);
    const hash = createHash("sha256").update(text);
    for (const rel of supportingFiles) hash.update(rel).update(fs.readFileSync(path.join(dir, rel)));
    return {
      name: meta.name || dirName,
      dir: dirName,
      description: meta.description || "",
      meta,
      body: body.replace(/^\s*\n/, ""),
      text,
      files: supportingFiles,
      version: hash.digest("hex").slice(0, 12),
      path: dir,
      updated: fs.statSync(file).mtime.toISOString(),
    };
  }

  function listSkills() {
    return fs
      .readdirSync(P.skills, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => loadSkill(d.name))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Exact lookup by name (case/punctuation-insensitive). Returns null if absent. */
  function getSkill(name) {
    const n = norm(name);
    if (!n) return null;
    return listSkills().find((s) => norm(s.name) === n || norm(s.dir) === n) || null;
  }

  /** Name-first fuzzy lookup: exact > prefix > substring > typo distance, then description words. */
  function findSkills(query, limit = 5) {
    const q = norm(query);
    const ts = terms(query);
    return listSkills()
      .map((s) => {
        const n = norm(s.name);
        let score = 0;
        if (q && n === q) score = 100;
        else if (q && n.startsWith(q)) score = 70;
        else if (q && (n.includes(q) || q.includes(n))) score = 50;
        else if (q) {
          const d = levenshtein(n, q);
          if (d <= Math.max(2, Math.floor(q.length / 4))) score = 40 - d * 5;
        }
        const desc = s.description.toLowerCase();
        for (const t of ts) if (t.length > 2 && (desc.includes(t) || s.name.toLowerCase().includes(t))) score += 6;
        return { ...s, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function safeJoin(base, rel) {
    const full = path.resolve(base, String(rel ?? ""));
    if (full !== base && !full.startsWith(base + path.sep)) fail("path escapes the skill folder");
    return full;
  }

  function readSkillFile(name, rel) {
    const skill = getSkill(name);
    if (!skill) return null;
    const full = safeJoin(skill.path, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) fail(`"${rel}" is not a file in skill "${skill.name}"`);
    if (fs.statSync(full).size > MAX_FILE_BYTES) fail("file is too large to return");
    return { skill, path: path.relative(skill.path, full), content: fs.readFileSync(full, "utf8") };
  }

  function saveSkill({ name, description, body, files = {}, version }) {
    const existing = getSkill(name);
    const dirName = existing ? existing.dir : slugify(name);
    if (!dirName) fail("name must contain letters or numbers");
    if (!String(description ?? "").trim()) fail("description is required");
    if (version !== undefined && (existing ? version !== existing.version : version !== "new")) {
      const e = new Error(existing ? `Skill "${existing.name}" changed (version ${existing.version}); read it before retrying.` :
        `Skill "${dirName}" no longer exists; use version "new" to create it.`);
      Object.assign(e, { userFacing: true, status: 409, conflict: true, current: existing });
      throw e;
    }
    for (const [rel, content] of Object.entries(files || {})) {
      if (rel === "SKILL.md") fail("SKILL.md must be written with body, not files");
      if (Buffer.byteLength(String(content)) > MAX_FILE_BYTES) fail(`file "${rel}" is too large`);
      safeJoin(path.join(P.skills, dirName), rel);
    }
    const dir = path.join(P.skills, dirName);
    fs.mkdirSync(dir, { recursive: true });
    const meta = { ...(existing?.meta || {}), name: existing?.name || dirName, description: String(description).trim() };
    fs.writeFileSync(path.join(dir, "SKILL.md"), serializeFrontmatter(meta, body));
    for (const [rel, content] of Object.entries(files || {})) {
      if (rel === "SKILL.md") continue;
      const full = safeJoin(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, String(content));
    }
    return { skill: loadSkill(dirName), created: !existing };
  }

  function deleteSkill(name) {
    const skill = getSkill(name);
    if (!skill) return null;
    fs.rmSync(skill.path, { recursive: true, force: true });
    return skill;
  }

  // ---------- activity ----------

  let writes = 0;
  function logActivity(entry) {
    try {
      fs.appendFileSync(P.activity, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
      if (++writes % 200 === 0) {
        const lines = fs.readFileSync(P.activity, "utf8").trim().split("\n");
        if (lines.length > 5000) fs.writeFileSync(P.activity, lines.slice(-3000).join("\n") + "\n");
      }
    } catch {
      /* logging must never break a tool call */
    }
  }

  function readActivity(limit = 200) {
    if (!fs.existsSync(P.activity)) return [];
    return fs
      .readFileSync(P.activity, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }

  return {
    root,
    paths: P,
    listProjects,
    listMemories,
    getMemory,
    saveMemory,
    deleteMemory,
    searchMemories,
    findSimilarMemories,
    backlinks,
    getProfile,
    profileVersion,
    saveProfile,
    getPolicy,
    savePolicy,
    listSkills,
    getSkill,
    findSkills,
    readSkillFile,
    saveSkill,
    deleteSkill,
    logActivity,
    readActivity,
    listSources,
    getSource,
    searchSources,
  };
}
