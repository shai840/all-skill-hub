// Minimal YAML frontmatter for hub files: flat keys plus one level of nesting
// (enough for Claude's `metadata:\n  type: user` memory format).

export function parseFrontmatter(text) {
  const src = String(text ?? "");
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  let parent = null;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // Block scalars: `key: >` (folded) or `key: |` (literal), body indented below.
    const block = line.match(/^(\s*)([\w.-]+):\s*([>|])[+-]?\s*$/);
    if (block) {
      const body = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) body.push(lines[++i]);
      const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
      const raw = body.map((l) => l.slice(indent));
      const value = (block[3] === ">" ? raw.join(" ").replace(/\s+/g, " ") : raw.join("\n")).trim();
      if (block[1] && parent) meta[parent][block[2]] = value;
      else {
        meta[block[2]] = value;
        parent = null;
      }
      continue;
    }
    const child = line.match(/^\s+([\w.-]+):\s*(.*)$/);
    if (child && parent) {
      meta[parent][child[1]] = unquote(child[2]);
      continue;
    }
    const top = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!top) continue;
    if (top[2].trim() === "") {
      meta[top[1]] = {};
      parent = top[1];
    } else {
      meta[top[1]] = unquote(top[2]);
      parent = null;
    }
  }
  return { meta, body: m[2] };
}

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function quote(v) {
  const s = String(v).replace(/\r?\n/g, " ");
  return /^[\s"'#&*!|>%@`{[\]-]|:\s|\s#|\s$/.test(s) ? JSON.stringify(s) : s;
}

const empty = (v) => v === undefined || v === null || v === "";

export function serializeFrontmatter(meta, body) {
  const out = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (empty(v)) continue;
    if (typeof v === "object") {
      const entries = Object.entries(v).filter(([, x]) => !empty(x));
      if (!entries.length) continue;
      out.push(`${k}:`);
      for (const [ck, cv] of entries) out.push(`  ${ck}: ${quote(cv)}`);
    } else {
      out.push(`${k}: ${quote(v)}`);
    }
  }
  out.push("---", "");
  return out.join("\n") + "\n" + String(body ?? "").trim() + "\n";
}
