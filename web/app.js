// All-Skill web UI — dependency-free single page app over /api.

const $app = document.getElementById("app");
const TYPES = ["user", "feedback", "project", "reference"];

// ---------- helpers ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const enc = encodeURIComponent;
const $ = (sel) => $app.querySelector(sel);
let routeController = null;
let routeLoading = false;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal || (routeLoading ? routeController?.signal : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) {
    location.href = `/login?return=${enc("/" + location.hash)}`;
    return new Promise(() => {}); // navigating away
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status });
  return data;
}

function toast(msg, err = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (err ? " err" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ""), 2600);
}

function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
const when = (iso) => `<span class="nowrap" title="${esc(iso ? new Date(iso).toLocaleString() : "")}">${ago(iso)}</span>`;

const typeBadge = (t) => (t ? `<span class="badge t-${esc(t)}">${esc(t)}</span>` : "");
const scopeLabel = (m) => (m.project ? esc(m.project) : "global");

function md(src) {
  const blocks = [];
  const text = esc(src).replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[\[([^\]]+)\]\]/g, (_, n) => `<a href="#/memories?q=${enc(n)}">[[${n}]]</a>`)
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  const closeList = () => list && (out.push(`</${list}>`), (list = null));
  for (const line of text.split("\n")) {
    let m;
    if ((m = line.match(/^\u0000(\d+)\u0000$/))) { closeList(); out.push(blocks[m[1]]); }
    else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { closeList(); out.push("<hr>"); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) closeList();
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join("\n").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function autosize(el) {
  const fit = () => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  };
  el.addEventListener("input", fit);
  requestAnimationFrame(fit);
}

// ---------- unsaved-changes guard ----------

let dirty = false;
let currentHash = location.hash;
let ignoreHash = false;
const markDirty = () => (dirty = true);
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

// ---------- router ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = raw.split("?");
  const [section = "", ...rest] = pathPart.split("/");
  return { section, arg: rest.length ? decodeURIComponent(rest.join("/")) : null, query: new URLSearchParams(query) };
}

async function route() {
  routeController?.abort();
  const controller = new AbortController();
  routeController = controller;
  routeLoading = true;
  const { section, arg, query } = parseHash();
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  const view = { "": overview, memories: arg ? memoryDetail : memories, skills: arg ? skillDetail : skills, profile, clients, activity }[section];
  dirty = false;
  currentHash = location.hash;
  const loading = setTimeout(() => {
    if (routeController === controller) $app.innerHTML = '<div class="loading-state" role="status">Loading…</div>';
  }, 160);
  $app.setAttribute("aria-busy", "true");
  try {
    window.scrollTo(0, 0);
    await (view || overview)(arg, query);
  } catch (e) {
    if (controller.signal.aborted) return;
    $app.innerHTML = `<h1>${e.status === 404 ? "Not found" : "Something went wrong"}</h1><p class="sub">${esc(e.message)}</p><p><a href="#/">← Overview</a></p>`;
  } finally {
    clearTimeout(loading);
    if (routeController === controller) {
      routeLoading = false;
      $app.removeAttribute("aria-busy");
    }
  }
}

window.addEventListener("hashchange", () => {
  if (ignoreHash) return void (ignoreHash = false);
  if (dirty && !confirm("You have unsaved changes. Leave without saving?")) {
    ignoreHash = true;
    location.hash = currentHash;
    return;
  }
  route();
});

// ---------- shared document editor (view first, edit on demand) ----------

/**
 * opts: { back, title, sub, view(): html, form(): html (fields above the body), body, bodyLabel,
 *         startEditing, onSave(values) -> Promise, onDelete?() -> Promise, after?() }
 */
function docEditor(opts) {
  let editing = Boolean(opts.startEditing);
  const render = () => {
    $app.innerHTML = `
      ${opts.back ? `<p class="back"><a href="${opts.back[0]}">← ${esc(opts.back[1])}</a></p>` : ""}
      <div class="toolbar">
        <div class="grow"><h1>${opts.title}</h1>${opts.sub ? `<p class="sub tight">${opts.sub}</p>` : ""}</div>
        <div class="row actions">${
          editing
            ? `${opts.startEditing ? "" : '<button class="ghost" id="cancel">Cancel</button>'}<button class="primary" id="save">Save <span class="kbd">⌘S</span></button>`
            : `${opts.onDelete ? '<button class="ghost danger" id="del">Delete</button>' : ""}<button class="primary" id="edit">Edit</button>`
        }</div>
      </div>
      ${
        editing
          ? `<div class="split"><div>${opts.form ? opts.form() : ""}<label>${esc(opts.bodyLabel || "Body")}</label><textarea id="body" class="mono">${esc(opts.body)}</textarea></div>
             <div><label>Preview</label><div class="panel md" id="preview"></div></div></div>`
          : opts.view()
      }`;
    if (editing) {
      const ta = $("#body");
      const prev = $("#preview");
      const update = () => (prev.innerHTML = md(ta.value) || '<p class="sub">Nothing to preview.</p>');
      ta.addEventListener("input", update);
      update();
      autosize(ta);
      $app.querySelectorAll("input, textarea, select").forEach((el) => el.addEventListener("input", markDirty));
      $app.querySelectorAll("textarea.auto").forEach(autosize);
      $("#save").onclick = save;
      const cancel = $("#cancel");
      if (cancel)
        cancel.onclick = () => {
          if (dirty && !confirm("Discard your changes?")) return;
          dirty = false;
          editing = false;
          render();
        };
    } else {
      $("#edit").onclick = () => {
        editing = true;
        render();
        $("#body")?.focus();
      };
      const del = $("#del");
      if (del) del.onclick = opts.onDelete;
    }
    opts.after?.(editing);
  };
  async function save() {
    const values = { body: $("#body").value };
    $app.querySelectorAll("[data-field]").forEach((el) => (values[el.dataset.field] = el.value.trim()));
    try {
      await opts.onSave(values);
      dirty = false;
    } catch (e) {
      toast(e.message, true);
    }
  }
  document.onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s" && editing) {
      e.preventDefault();
      save();
    }
  };
  render();
}

// ---------- overview ----------

async function overview() {
  const d = await api("/api/overview");
  $app.innerHTML = `
    <h1>Your hub</h1>
    <p class="sub">One place for your memories, context and skills, shared by every AI tool you connect.</p>
    <p class="hub-summary"><a href="#/memories">${d.counts.memories} memories</a><span>·</span><a href="#/memories">${d.counts.projects} projects</a><span>·</span><a href="#/skills">${d.counts.skills} skills</a><span>·</span><a href="#/clients">${d.clients.length} connections</a></p>
    <div class="split">
      <div>
        <h2>Recently updated memories</h2>
        <div class="panel list">${d.recentMemories.map(memoryItem).join("") || '<div class="empty">No memories yet.</div>'}</div>
      </div>
      <div>
        <h2>Connections</h2>
        <div class="panel list">${
          d.clients
            .map((c) => `<div class="item"><div class="row"><span class="title">${esc(c.client)}</span><span class="badge">${esc(c.adapter)}</span></div>
              <div class="meta"><span>${esc(c.transport)}</span><span>${c.calls} tool calls</span><span>last seen ${when(c.lastSeen)}</span></div></div>`)
            .join("") || '<div class="empty">No app has connected yet.</div>'
        }</div>
        <p class="overview-link"><a href="#/activity">View recent activity →</a></p>
      </div>
    </div>`;
}

// ---------- memories ----------

function memoryItem(m, { showScope = true } = {}) {
  return `<a class="item" href="#/memories/${enc(m.id)}">
    <div class="row"><span class="title">${esc(m.name)}</span>${typeBadge(m.type)}${showScope ? `<span class="scope">${scopeLabel(m)}</span>` : ""}</div>
    <div class="desc clamp">${esc(m.description)}</div>
    <div class="meta">${when(m.updated)}</div>
    ${m.snippet ? `<div class="meta clamp">${esc(m.snippet)}</div>` : ""}
  </a>`;
}

async function memories(_, query) {
  const q = query.get("q") || "";
  const scope = query.get("scope") || "all";
  const type = query.get("type") || "";
  const d = await api(`/api/memories${q ? `?q=${enc(q)}` : ""}`);
  const all = d.memories;
  let list = all;
  if (scope === "global") list = list.filter((m) => m.scope === "global");
  else if (scope !== "all") list = list.filter((m) => m.project === scope);
  if (type) list = list.filter((m) => m.type === type);
  if (!q) list.sort((a, b) => b.updated.localeCompare(a.updated));

  const countIn = (fn) => all.filter(fn).length;
  const setQ = (k, v) => {
    const p = new URLSearchParams(query);
    v ? p.set(k, v) : p.delete(k);
    location.hash = `#/memories${p.toString() ? `?${p}` : ""}`;
  };

  // Group by scope when browsing everything, so projects read as sections.
  let listHtml;
  if (scope === "all" && !q && !type && list.length) {
    const groups = new Map();
    for (const m of list) {
      const k = m.project || "global";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    const global = groups.get("global") || [];
    const projects = [...groups.keys()].filter((k) => k !== "global").sort((a, b) => a.localeCompare(b));
    listHtml = `${global.length ? `<h2 class="group">Global <span>${global.length}</span></h2>
      <div class="panel list">${global.slice(0, 4).map((m) => memoryItem(m, { showScope: false })).join("")}
      ${global.length > 4 ? `<a class="group-more" href="#/memories?scope=global">View all global memories →</a>` : ""}</div>` : ""}
      ${projects.length ? `<h2 class="group">Projects <span>${projects.length}</span></h2><div class="panel list">${projects.map((k) =>
        `<a class="item project-item" href="#/memories?scope=${enc(k)}"><span class="title">${esc(k)}</span><span class="scope">${groups.get(k).length} ${groups.get(k).length === 1 ? "memory" : "memories"} →</span></a>`).join("")}</div>` : ""}`;
  } else {
    listHtml = `<div class="panel list">${list.map(memoryItem).join("") || `<div class="empty">No memories match${q ? ` “${esc(q)}”` : ""}.</div>`}</div>`;
  }

  $app.innerHTML = `
    <div class="toolbar"><div class="grow"><h1>Memories</h1><p class="sub tight">What your connected AI apps should remember, organized by project.</p></div>
      <div class="actions"><a class="btn primary" href="#/memories/new">New memory</a></div></div>
    <div class="filters">
      <form id="search" class="row"><input id="q" class="grow" type="search" placeholder="Search memories…" value="${esc(q)}"><button>Search</button></form>
      <div class="row">
        <select id="scope" aria-label="Scope">
          <option value="all">All scopes (${all.length})</option>
          <option value="global">Global (${countIn((m) => m.scope === "global")})</option>
          ${d.projects.map((p) => `<option value="${esc(p)}">${esc(p)} (${countIn((m) => m.project === p)})</option>`).join("")}
        </select>
        <select id="type" aria-label="Memory type">
          <option value="">All types</option>
          ${TYPES.map((t) => `<option value="${t}">${t} (${countIn((m) => m.type === t)})</option>`).join("")}
        </select>
      </div>
      ${q || scope !== "all" || type ? `<p class="meta">${list.length} of ${all.length} shown · <a href="#/memories">clear filters</a></p>` : ""}
    </div>
    ${listHtml}`;

  const sel = $("#scope");
  sel.value = scope;
  sel.onchange = () => setQ("scope", sel.value === "all" ? "" : sel.value);
  const typeSel = $("#type");
  typeSel.value = type;
  typeSel.onchange = () => setQ("type", typeSel.value);
  $("#search").onsubmit = (e) => {
    e.preventDefault();
    setQ("q", $("#q").value.trim());
  };
  if (q) $("#q").focus();
}

async function memoryDetail(id) {
  const isNew = id === "new";
  const [{ projects }, m] = await Promise.all([
    api("/api/memories"),
    isNew ? { name: "", description: "", type: "user", body: "", project: null, backlinks: [], links: [] } : api(`/api/memory?id=${enc(id)}`).then((r) => r.memory),
  ]);
  const by = (who) => (who ? ` by ${esc(who)}` : "");
  docEditor({
    back: ["#/memories", "Memories"],
    title: isNew ? "New memory" : esc(m.name),
    sub: isNew ? "" : `${typeBadge(m.type)} <span class="scope">${scopeLabel(m)}</span> · created ${when(m.created)}${by(m.createdBy)} · updated ${when(m.updated)}${by(m.source)}`,
    startEditing: isNew,
    body: m.body,
    view: () => `
      <p class="lede">${esc(m.description)}</p>
      <div class="panel md">${md(m.body) || '<p class="sub">Empty.</p>'}</div>
      ${m.links?.length ? `<label>Links to</label><div class="chips">${m.links.map((l) => `<a class="chip" href="#/memories?q=${enc(l)}">[[${esc(l)}]]</a>`).join("")}</div>` : ""}
      ${m.backlinks?.length ? `<label>Linked from</label><div class="chips">${m.backlinks.map((b) => `<a class="chip" href="#/memories/${enc(b)}">${esc(b)}</a>`).join("")}</div>` : ""}
      <p class="meta file"><code>hub/${esc(m.file)}</code> · version ${esc(m.version)}</p>
      <div id="history"></div>`,
    after: (editing) => !editing && !isNew && loadHistory(m.file),
    form: () => `
      <label for="f-name">Name</label><input id="f-name" data-field="name" class="field mono" value="${esc(m.name)}" placeholder="prefers-typescript" required>
      <label for="f-desc">Description <span class="hint">one line every app sees in the index</span></label>
      <textarea id="f-desc" data-field="description" class="field auto short">${esc(m.description)}</textarea>
      <div class="row two">
        <div><label for="f-type">Type</label><select id="f-type" data-field="type" class="field">${TYPES.map((t) => `<option ${m.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div><label for="f-proj">Scope <span class="hint">empty = global</span></label><input id="f-proj" data-field="project" class="field" list="projects" value="${esc(m.project || "")}" placeholder="global"></div>
      </div>
      <datalist id="projects">${projects.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>`,
    onSave: async (v) => {
      if (!v.name) throw new Error("Name is required");
      if (!v.description) throw new Error("Description is required");
      try {
        const r = await api("/api/memory", {
          method: "PUT",
          body: { originalId: isNew ? null : m.id, version: isNew ? "new" : m.version, name: v.name, description: v.description, type: v.type, project: v.project || null, body: v.body },
        });
        dirty = false;
        toast("Saved");
        const next = `#/memories/${enc(r.memory.id)}`;
        if (location.hash === next) route();
        else location.hash = next;
      } catch (e) {
        if (e.status === 409) throw new Error(isNew ? "A memory with that name already exists in this scope." : "Another app changed this memory since you opened it. Copy your text, reload, and merge.");
        throw e;
      }
    },
    onDelete: isNew
      ? null
      : async () => {
          if (!confirm(`Delete memory "${m.id}"? This removes the file from the hub.`)) return;
          await api(`/api/memory?id=${enc(m.id)}`, { method: "DELETE" });
          toast("Deleted");
          location.hash = "#/memories";
        },
  });
}


// ---------- history ----------

async function loadHistory(file) {
  const box = $("#history");
  if (!box || !file) return;
  const { commits } = await api(`/api/history?path=${enc(file)}`).catch(() => ({ commits: [] }));
  if (!commits.length) return void (box.innerHTML = "");
  box.innerHTML = `<details class="history"><summary>History <span class="n">${commits.length} version${commits.length === 1 ? "" : "s"}</span></summary>
    <div class="panel list">${commits
      .map((c, i) => `<div class="item"><div class="row spread"><div><code>${esc(c.rev)}</code> ${esc(c.message)}<div class="meta">${when(c.date)}<span>by ${esc(c.author)}</span>${i === 0 ? "<span>current</span>" : ""}</div></div>
        <div class="row"><button class="ghost" data-view="${esc(c.rev)}">View</button>${i === 0 ? "" : `<button class="ghost" data-restore="${esc(c.rev)}">Restore</button>`}</div></div></div>`)
      .join("")}</div><pre class="out" id="hist-out" hidden></pre></details>`;
  box.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = async () => {
        const { text } = await api(`/api/history/show?path=${enc(file)}&rev=${enc(b.dataset.view)}`);
        const out = $("#hist-out");
        out.hidden = false;
        out.textContent = text;
      })
  );
  box.querySelectorAll("[data-restore]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`Restore this to version ${b.dataset.restore}? The current text stays in history.`)) return;
        await api("/api/history/restore", { method: "POST", body: { path: file, rev: b.dataset.restore } });
        toast("Restored");
        route();
      })
  );
}

// ---------- skills ----------

async function skills(_, query) {
  const q = query.get("q") || "";
  const d = await api(`/api/skills${q ? `?q=${enc(q)}` : ""}`);
  $app.innerHTML = `
    <div class="toolbar"><div class="grow"><h1>Skills</h1><p class="sub tight">Shared instructions your connected AI apps can find and use.</p></div>
      <div class="actions"><a class="btn primary" href="#/skills/new">New skill</a></div></div>
    <form id="search" class="row search-form"><input id="q" class="grow" type="search" aria-label="Search skills" placeholder="Find a skill by name or topic…" value="${esc(q)}"><button>Search</button></form>
    ${q ? `<p class="meta">${d.skills.length} match${d.skills.length === 1 ? "" : "es"} · <a href="#/skills">show all</a></p>` : ""}
    <div class="panel list">${
      d.skills
        .map((s) => `<a class="item" href="#/skills/${enc(s.name)}"><div class="title">${esc(s.name)}</div><div class="desc clamp">${esc(s.description)}</div>
          <div class="meta">${when(s.updated)}${s.files.length ? `<span>${s.files.length} supporting file${s.files.length === 1 ? "" : "s"}</span>` : ""}</div></a>`)
        .join("") || '<div class="empty">No skills match.</div>'
    }</div>`;
  $("#search").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#q").value.trim();
    location.hash = `#/skills${v ? `?q=${enc(v)}` : ""}`;
  };
  if (q) $("#q").focus();
}

async function skillDetail(name) {
  const isNew = name === "new";
  const s = isNew ? { name: "", description: "", body: "", files: [] } : (await api(`/api/skill?name=${enc(name)}`)).skill;
  const filesHtml = () =>
    s.files.length
      ? `<label>Supporting files</label><div class="chips">${s.files.map((f) => `<button class="chip" data-file="${esc(f)}">${esc(f)}</button>`).join("")}</div><pre class="out" id="file-out" hidden></pre>`
      : "";
  docEditor({
    back: ["#/skills", "Skills"],
    title: isNew ? "New skill" : esc(s.name),
    sub: isNew ? "" : `updated ${when(s.updated)} · <code>${esc(s.path)}</code>`,
    startEditing: isNew,
    body: s.body,
    bodyLabel: "Instructions (SKILL.md body)",
    view: () => `<p class="lede">${esc(s.description)}</p><div class="panel md">${md(s.body)}</div>${filesHtml()}<div id="history"></div>`,
    form: () => `
      <label for="f-name">Name</label><input id="f-name" data-field="name" class="field mono" value="${esc(s.name)}" ${isNew ? "" : "readonly"} placeholder="commit-message">
      <label for="f-desc">Description <span class="hint">when to use it; this decides whether an app picks it</span></label>
      <textarea id="f-desc" data-field="description" class="field auto">${esc(s.description)}</textarea>`,
    onSave: async (v) => {
      if (!v.name) throw new Error("Name is required");
      if (!v.description) throw new Error("Description is required");
      const r = await api("/api/skill", { method: "PUT", body: { name: v.name, description: v.description, body: v.body, version: isNew ? "new" : s.version } });
      dirty = false;
      toast("Saved");
      const next = `#/skills/${enc(r.skill.name)}`;
      if (location.hash === next) route();
      else location.hash = next;
    },
    onDelete: isNew
      ? null
      : async () => {
          if (!confirm(`Delete skill "${s.name}" and its whole folder?`)) return;
          await api(`/api/skill?name=${enc(s.name)}`, { method: "DELETE" });
          toast("Deleted");
          location.hash = "#/skills";
        },
    after: (editing) => {
      if (editing) return;
      if (!isNew) loadHistory(`skills/${s.dir}/SKILL.md`);
      $app.querySelectorAll("[data-file]").forEach(
        (b) =>
          (b.onclick = async () => {
            const out = $("#file-out");
            const same = !out.hidden && out.dataset.file === b.dataset.file;
            $app.querySelectorAll("[data-file]").forEach((x) => x.classList.remove("on"));
            if (same) return void (out.hidden = true);
            const f = await api(`/api/skill/file?name=${enc(s.name)}&path=${enc(b.dataset.file)}`);
            b.classList.add("on");
            out.hidden = false;
            out.dataset.file = b.dataset.file;
            out.textContent = f.content;
          })
      );
    },
  });
}

// ---------- profile & policy ----------

async function profile(_, query) {
  const doc = query.get("doc") === "policy" ? "policy" : "profile";
  const { text } = await api(`/api/${doc}`);
  const tabs = `<div class="tabs">
      <a class="chip ${doc === "profile" ? "on" : ""}" href="#/profile">About me</a>
      <a class="chip ${doc === "policy" ? "on" : ""}" href="#/profile?doc=policy">Saving policy</a></div>`;
  docEditor({
    title: "Profile",
    sub:
      doc === "policy"
        ? "What apps may save, and what needs your OK first. Every app gets this with its context and applies it before writing a memory."
        : "Who you are, what you work on and where your information lives. Every app gets this at the start of a conversation.",
    body: text,
    bodyLabel: doc === "policy" ? "Saving policy" : "About me",
    view: () => `${tabs}<div class="panel md">${md(text) || '<p class="sub">Empty. Click Edit to write it.</p>'}</div>`,
    form: () => tabs,
    onSave: async (v) => {
      await api(`/api/${doc}`, { method: "PUT", body: { text: v.body } });
      dirty = false;
      toast(doc === "policy" ? "Saving policy saved" : "Profile saved");
      route();
    },
  });
}

// ---------- clients ----------

function exampleArgs(tool) {
  const props = tool.inputSchema?.properties || {};
  const sample = { query: "commit", name: "hub-check", id: "profile", path: "", project: "" };
  const out = {};
  for (const k of tool.inputSchema?.required || []) out[k] = sample[k] ?? "";
  if (!Object.keys(out).length && props.project) return "{}";
  return JSON.stringify(out);
}

async function clients(_, query) {
  const d = await api("/api/adapters");
  const a = d.adapters.find((x) => x.id === query.get("a")) || d.adapters[0];
  const readTools = a.tools.filter((t) => t.annotations?.readOnlyHint);
  $app.innerHTML = `
    <h1>Clients</h1>
    <p class="sub">Choose an AI app to see its connection address and available tools.</p>
    <div class="tabs">${d.adapters.map((x) => `<a class="chip ${x.id === a.id ? "on" : ""}" href="#/clients?a=${x.id}">${esc(x.label)}</a>`).join("")}</div>
    <p>${esc(a.summary)}</p>
    <div class="panel"><table class="kv">
      <tr><th>Endpoint</th><td><code>${esc(a.endpoint)}</code></td></tr>
      <tr><th>Auto-detect</th><td><code>${esc(d.autoEndpoint)}</code> <span class="meta">picks the adapter from the app's name</span></td></tr>
      ${d.autoEndpoint.startsWith("https://") ? "" : `<tr><th>Local</th><td><code>node server/index.mjs --client ${esc(a.id)}</code></td></tr>`}</table></div>
    <h2>See what ${esc(a.label)} sees</h2>
    <form id="run-form" class="row"><select id="tool" aria-label="Tool">${readTools.map((t) => `<option>${esc(t.name)}</option>`).join("")}</select>
      <input id="args" class="grow mono" aria-label="Arguments (JSON)"><button class="primary">Run</button></form>
    <pre class="out" id="out">Pick a read-only tool and run it to see exactly what ${esc(a.label)} receives.</pre>
    <h2>Tools <span class="n">${a.tools.length}</span></h2>
    <div class="panel table-scroll"><table class="tools-table"><tr><th>Tool</th><th>Description</th><th>Kind</th></tr>${a.tools
      .map((t) => `<tr><td><code>${esc(t.name)}</code></td><td>${esc(t.description)}<details><summary>input schema</summary><pre class="out">${esc(JSON.stringify(t.inputSchema, null, 2))}</pre></details></td>
        <td>${t.annotations?.readOnlyHint ? '<span class="badge">read</span>' : t.annotations?.destructiveHint ? '<span class="badge bad">delete</span>' : '<span class="badge t-project">write</span>'}</td></tr>`)
      .join("")}</table></div>
    <h2>Instructions sent when ${esc(a.label)} connects</h2>
    <div class="panel md">${md(a.instructions)}</div>`;
  const toolSel = $("#tool");
  const args = $("#args");
  const fill = () => (args.value = exampleArgs(readTools.find((t) => t.name === toolSel.value)));
  toolSel.onchange = fill;
  fill();
  $("#run-form").onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#out");
    try {
      const r = await api("/api/preview", { method: "POST", body: { adapter: a.id, tool: toolSel.value, args: JSON.parse(args.value || "{}") } });
      out.textContent = r.structuredContent ? JSON.stringify(r.structuredContent, null, 2) : r.content.map((c) => c.text).join("\n");
      out.classList.toggle("bad", Boolean(r.isError));
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
      out.classList.add("bad");
    }
  };
}

// ---------- activity ----------

function activityTable(rawRows) {
  const rows = [];
  for (const row of rawRows) {
    const previous = rows.at(-1);
    if (row.event === "connect" && previous?.event === "connect" && row.client === previous.client && row.adapter === previous.adapter) {
      previous.repeat = (previous.repeat || 1) + 1;
    } else {
      rows.push({ ...row });
    }
  }
  if (!rows.length) return '<div class="empty">Nothing yet.</div>';
  return `<table class="activity"><tr><th>When</th><th>App</th><th>What</th></tr>${rows
    .map((r) => {
      let what;
      if (r.event === "tool") {
        const args = r.args || {};
        const detail = Object.keys(args).length ? `<pre class="out">${esc(JSON.stringify(args, null, 2))}</pre>` : "";
        const error = r.error ? `<pre class="out bad">${esc(r.error)}</pre>` : "";
        what = `<code>${esc(r.tool)}</code> <span class="${r.ok ? "ok" : "bad"}">${r.ok ? "Completed" : "Failed"}</span>
          ${detail || error ? `<details class="activity-detail"><summary>Details</summary>${detail}${error}</details>` : ""}`;
      } else if (r.event === "connect") {
        what = `Connected <span class="meta inline">${esc(r.adapter)}${r.repeat ? ` · ${r.repeat} times` : ""}</span>`;
      } else if (r.event === "login") {
        what = "Signed in";
      } else {
        what = `Edited ${esc(r.what || r.event)}`;
      }
      return `<tr><td>${when(r.ts)}</td><td class="who">${esc(r.client)}</td><td>${what}</td></tr>`;
    })
    .join("")}</table>`;
}

async function activity(_, query) {
  const limit = Math.min(500, Math.max(50, Number(query.get("limit")) || 50));
  const d = await api(`/api/activity?limit=${limit}`);
  $app.innerHTML = `<h1>Activity</h1><p class="sub">Recent sign-ins, connections and tool calls.</p>
    <div class="panel table-scroll">${activityTable(d.activity)}</div>
    ${d.activity.length === limit && limit < 500 ? `<p class="load-more"><a class="btn" href="#/activity?limit=${limit + 50}">Show 50 more</a></p>` : ""}`;
}

// ---------- boot ----------

Promise.all([api("/api/health"), api("/api/me")])
  .then(([h, me]) => {
    const foot = document.getElementById("side-foot");
    foot.innerHTML = me.user
      ? `<span class="label">Signed in</span><span class="path" title="${esc(me.user)}">${esc(me.user)}</span><a class="signout" href="/logout">Sign out</a>`
      : `<span class="label">Hub folder</span><span class="path" title="${esc(h.hubDir || "")}">${esc((h.hubDir || "").split("/").slice(-2).join("/"))}</span>`;
  })
  .catch(() => {});
route();
