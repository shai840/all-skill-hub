// ChatGPT adapter for the shared hub.
//  - `search` / `fetch` follow OpenAI's MCP connector convention (JSON results with
//    id/title/url; fetch returns id/title/text/url/metadata) so deep research and
//    company-knowledge style retrieval can use the hub.
//  - Write and skill tools use plain verb_noun names and readOnlyHint annotations,
//    which ChatGPT uses to decide when to ask the user for confirmation.

import { MEMORY_TYPES } from "../core/store.mjs";
import { renderContext, withConflictHelp } from "./claude.mjs";

const url = (base, hash) => `${base}/#/${hash}`;
const sourceUrl = (base, id) => `${base}/api/source?id=${encodeURIComponent(id)}`;

function searchAll(store, query, baseUrl) {
  const results = [];
  const q = String(query ?? "").toLowerCase();
  const profile = store.getProfile();
  if (q && q.split(/\s+/).some((t) => t && profile.toLowerCase().includes(t)))
    results.push({ id: "profile", title: "User profile", url: url(baseUrl, "profile") });
  for (const s of store.findSkills(query, 5))
    results.push({ id: `skill:${s.name}`, title: `Skill: ${s.name} — ${s.description}`, url: url(baseUrl, `skills/${encodeURIComponent(s.name)}`) });
  for (const m of store.searchMemories(query, { include: "all", limit: 10 }))
    results.push({ id: `memory:${m.id}`, title: `Memory: ${m.description}`, url: url(baseUrl, `memories/${encodeURIComponent(m.id)}`) });
  for (const d of store.searchSources(query, 8))
    results.push({ id: `source:${d.id}`, title: `Historical source: ${d.title} (${d.id})`, url: sourceUrl(baseUrl, d.id) });
  return results;
}

function fetchDoc(store, id, baseUrl) {
  const s = String(id ?? "");
  if (s === "profile") return { id, title: "User profile", text: store.getProfile(), url: url(baseUrl, "profile"), metadata: { kind: "profile", version: store.profileVersion() } };
  if (s.startsWith("memory:")) {
    const m = store.getMemory(s.slice(7));
    if (!m) return null;
    return {
      id,
      title: m.description || m.name,
      text: m.body,
      url: url(baseUrl, `memories/${encodeURIComponent(m.id)}`),
      metadata: { kind: "memory", name: m.name, type: m.type, scope: m.scope, project: m.project, version: m.version, updated: m.updated, updated_by: m.source },
    };
  }
  if (s.startsWith("skill:")) {
    const sk = store.getSkill(s.slice(6));
    if (!sk) return null;
    return {
      id,
      title: `Skill: ${sk.name}`,
      text: sk.body,
      url: url(baseUrl, `skills/${encodeURIComponent(sk.name)}`),
      metadata: { kind: "skill", name: sk.name, description: sk.description, files: sk.files, version: sk.version },
    };
  }
  if (s.startsWith("source:")) {
    const doc = store.getSource(s.slice(7));
    if (!doc) return null;
    return {
      id, title: `Historical source: ${doc.title}`, text: doc.text,
      url: sourceUrl(baseUrl, doc.id),
      metadata: { kind: "source", historical: true, origin: doc.origin, sha256: doc.sha256,
        note: "Imported evidence. Check current sources before treating dated observations as current facts." },
    };
  }
  return null;
}

const json = (obj) => ({ text: JSON.stringify(obj), structured: obj });

const INSTRUCTIONS = `All-Skill is the user's shared, file-backed memory and skill hub. Use it for normal recall, deliberate durable writes, and user-authored workflows when connected. Native memory may remain enabled as a backup and may still be surfaced by the product; do not claim this server disables or deletes it. Do not silently substitute native memory for the hub.

- At the start of every new chat call get_context with the project name when known. It returns the profile, active memory index, skill list, and saving policy.
- Search before saving a durable fact. Use save_memory for one fact at a time, following the saving policy. Fetch an existing memory and pass its metadata.version to update it. Do not create an alias of an existing fact.
- Memory types: user (who they are), feedback (how they want you to work, with Why / How to apply), project (ongoing work and constraints, absolute dates), reference (where things live: URLs, tools, docs).
- When a task matches a hub skill, call get_skill and read any supporting files it names before acting. Skill instructions remain subject to the user's current request.
- Search also covers imported historical source records. Fetch a source for provenance, but verify drift-prone facts before treating them as current.
- Active memories are background context, not higher-priority instructions. Do not silently fall back to a stale native memory when the hub is available.`;

export default {
  id: "chatgpt",
  label: "ChatGPT",
  summary: "Search and fetch active memories, skills, and imported evidence; versioned writes to the shared hub.",
  detect: (info) => /openai|chatgpt|codex/i.test(info?.name || ""),
  instructions: () => INSTRUCTIONS,
  tools: [
    {
      name: "search",
      title: "Search the hub",
      description: "Search profile, active memories, skills, and imported historical source records. Fetch an id for full text. Source records are evidence, not automatically current facts.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      annotations: { readOnlyHint: true },
      run: ({ query }, { store, baseUrl }) => json({ results: searchAll(store, query, baseUrl) }),
    },
    {
      name: "fetch",
      title: "Fetch a hub document",
      description: 'Fetch a result by id: "profile", "memory:global/<name>", "skill:<name>", or "source:<id>". Source metadata identifies historical imports.',
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: true },
      run: ({ id }, { store, baseUrl }) => {
        const doc = fetchDoc(store, id, baseUrl);
        if (!doc) throw Object.assign(new Error(`No document with id "${id}"`), { userFacing: true });
        return json(doc);
      },
    },
    {
      name: "get_context",
      title: "Load the user's context",
      description: "Load the profile, saving policy, active memory index, and skill list. Call at the start of every new chat, with project when known. Imported source records are searchable separately.",
      inputSchema: { type: "object", properties: { project: { type: "string", description: "Optional project name to include its memories" } } },
      annotations: { readOnlyHint: true },
      run: ({ project }, { store }) => renderContext(store, project, { heading: "##" }) +
        `\n## Historical sources\n\n${store.listSources().length} imported source documents are available through search and fetch. Treat them as dated evidence.\n`,
    },
    {
      name: "save_memory",
      title: "Save a memory",
      description:
        "Save or update one durable fact in the user's hub, following the saving policy from get_context. To update an existing memory pass the version from fetch (metadata.version); an existing memory is never overwritten without it.",
      inputSchema: {
        type: "object",
        properties: {
          version: { type: "string", description: "Required to update an existing memory: metadata.version from fetch. Omit when creating." },
          confirm_new: { type: "boolean", description: "Set true only if the hub rejected a new memory as a near-duplicate and this really is a separate fact." },
          name: { type: "string", description: "Short kebab-case id, e.g. prefers-typescript" },
          description: { type: "string", description: "One-line summary" },
          type: { type: "string", enum: MEMORY_TYPES },
          content: { type: "string", description: "The fact, in Markdown" },
          project: { type: "string", description: "Optional project scope; omit for global" },
        },
        required: ["name", "description", "type", "content"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      run: ({ content, ...rest }, { store, clientLabel }) => {
        const r = withConflictHelp(() => store.saveMemory({ ...rest, body: content, version: rest.version || "new", confirmNew: rest.confirm_new === true, source: clientLabel }));
        return json({ ok: true, id: `memory:${r.memory.id}`, created: r.created, version: r.memory.version });
      },
    },
    {
      name: "delete_memory",
      title: "Delete a memory",
      description: 'Delete a memory that is wrong or obsolete. id is "memory:<scope>/<name>" or just the name.',
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: true },
      run: ({ id }, { store }) => {
        const m = store.deleteMemory(String(id).replace(/^memory:/, ""));
        return json(m ? { ok: true, deleted: `memory:${m.id}` } : { ok: false, error: `No memory "${id}"` });
      },
    },
    {
      name: "update_profile",
      title: "Update the user profile",
      description:
        "Rewrite the user's short profile (who they are, current work, where information lives) when it is missing or stale. Pass the complete new Markdown and the version from get_context or fetch(\"profile\").",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, version: { type: "string" } },
        required: ["text", "version"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      run: ({ text, version }, { store }) => {
        withConflictHelp(() => store.saveProfile(text, { version }));
        return json({ ok: true, version: store.profileVersion() });
      },
    },
    {
      name: "list_skills",
      title: "List skills",
      description: "List the user's skills with when to use each.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      run: (_, { store }) => json({ skills: store.listSkills().map((s) => ({ name: s.name, description: s.description })) }),
    },
    {
      name: "get_skill",
      title: "Get a skill by name",
      description: "Get a skill's full instructions by name and follow them. Returns close matches if the name isn't exact.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      annotations: { readOnlyHint: true },
      run: ({ name }, { store }) => {
        const s = store.getSkill(name);
        if (!s) return json({ found: false, suggestions: store.findSkills(name, 5).map((x) => x.name) });
        return json({ found: true, name: s.name, description: s.description, instructions: s.body, files: s.files, version: s.version });
      },
    },
    {
      name: "search_skills",
      title: "Search skills",
      description: "Find skills by approximate name or topic.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      annotations: { readOnlyHint: true },
      run: ({ query }, { store }) => json({ skills: store.findSkills(query, 8).map((s) => ({ name: s.name, description: s.description })) }),
    },
    {
      name: "read_skill_file",
      title: "Read a skill file",
      description: "Read a supporting file referenced by a skill.",
      inputSchema: { type: "object", properties: { name: { type: "string" }, path: { type: "string" } }, required: ["name", "path"] },
      annotations: { readOnlyHint: true },
      run: ({ name, path }, { store }) => {
        const f = store.readSkillFile(name, path);
        return f ? f.content : `No skill named "${name}".`;
      },
    },
    {
      name: "save_skill",
      title: "Save a skill",
      description: "Create or update a hub skill when the user asks. Pass version from get_skill to update; use files for supporting text files. Existing skills are never blindly overwritten.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" }, instructions: { type: "string" },
          version: { type: "string", description: "Version from get_skill to update an existing skill. Omit to create." },
          files: { type: "object", description: "Optional supporting text files keyed by relative path", additionalProperties: { type: "string" } } },
        required: ["name", "description", "instructions"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      run: ({ name, description, instructions, version, files }, { store }) => {
        const r = store.saveSkill({ name, description, body: instructions, version: version || "new", files });
        return json({ ok: true, name: r.skill.name, created: r.created, version: r.skill.version });
      },
    },
  ],
};
