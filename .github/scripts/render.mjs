// Renders the profile visuals (terminal, project cards, stats, languages) as SVG.
// Usage: GITHUB_TOKEN=... node .github/scripts/render.mjs <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOGIN = "liwidale";
const PROJECTS = ["kumo", "liauth", "claude-portable", "lolzteam-api-ts"];
const OUT = process.argv[2] ?? "dist";

const C = { bg: "#0A0A0A", border: "#262626", text: "#EDEDED", muted: "#A1A1A1", dim: "#525252", accent: "#4C9DFF" };
const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => n.toLocaleString("en-US");

const svg = (w, h, body, style = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
<style>
  .sans { font-family: ${SANS}; } .mono { font-family: ${MONO}; }
  .card { animation: in 150ms ease-out both; }
  @keyframes in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  ${style}
</style>
${body}
</svg>
`;

const frame = (w, h, title) => `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${C.bg}" stroke="${C.border}"/>
<text x="20" y="34" class="sans" font-size="15" font-weight="600" fill="${C.text}"><tspan fill="${C.accent}">ゝ</tspan> ${esc(title)}</text>`;

function wrap(text, max, lines) {
  const out = [""];
  for (const word of text.split(/\s+/)) {
    const cur = out[out.length - 1];
    if ((cur + " " + word).trim().length <= max) out[out.length - 1] = (cur + " " + word).trim();
    else out.push(word);
  }
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = out[lines - 1].replace(/[\s,.;:]*\S{0,3}$/, "") + "…";
  }
  return out;
}

async function query() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      variables: { login: LOGIN },
      query: `query($login: String!) {
        user(login: $login) {
          followers { totalCount }
          contributionsCollection { totalCommitContributions restrictedContributionsCount contributionCalendar { totalContributions } }
          repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
            totalCount
            nodes {
              name description stargazerCount
              primaryLanguage { name color }
              licenseInfo { spdxId }
              latestRelease { tagName }
              languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
            }
          }
        }
      }`,
    }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user;
}

function terminal() {
  const W = 480, H = 270, X = 18, LH = 25, FS = 13, CW = FS * 0.6;
  const PROMPT = "liwidale@Liwidale %";
  const script = [
    ["cmd", "whoami"], ["out", "liwidale · computer-science student"],
    ["cmd", "cat roles.txt"], ["out", "programmer · web designer · tech enthusiast"],
    ["cmd", "cat focus.txt"], ["out", "fast systems with beautiful interfaces"], ["out", "complex ideas, simple experiences"],
    ["end", ""],
  ];
  let t = 0.4, y = 62, body = "", keyframes = "";
  script.forEach(([kind, text], i) => {
    const cmdX = X + (PROMPT.length + 1) * CW;
    const fixed = (s) => `textLength="${(s.length * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs"`;
    if (kind === "out") {
      body += `<text x="${X}" y="${y}" class="mono ln" font-size="${FS}" fill="${C.muted}" ${fixed(text)} style="animation-delay:${t.toFixed(2)}s">${esc(text)}</text>\n`;
      t += 0.15;
    } else {
      const n = text.length, dur = n * 0.07, w = n * CW;
      const caret = kind === "end"
        ? `<rect x="${cmdX}" y="${y - FS + 2}" width="${CW}" height="${FS + 2}" fill="${C.accent}" class="blink"/>`
        : `<rect x="${cmdX}" y="${y - FS + 2}" width="${CW}" height="${FS + 2}" fill="${C.accent}" class="gone" style="animation-delay:${(t + 0.35 + dur + 0.25).toFixed(2)}s"/>`;
      if (n) keyframes += `@keyframes t${i} { to { transform: translateX(${w.toFixed(1)}px); } }\n`;
      body += `<g class="ln" style="animation-delay:${t.toFixed(2)}s">
  <text x="${X}" y="${y}" class="mono" font-size="${FS}" ${fixed(PROMPT)}><tspan fill="${C.accent}">liwidale</tspan><tspan fill="${C.dim}">@</tspan><tspan fill="${C.text}">Liwidale</tspan><tspan fill="${C.dim}"> %</tspan></text>
  ${n ? `<text x="${cmdX}" y="${y}" class="mono" font-size="${FS}" fill="${C.text}" ${fixed(text)}>${esc(text)}</text>` : ""}
  <g ${n ? `style="animation: t${i} ${dur.toFixed(2)}s steps(${n}) ${(t + 0.35).toFixed(2)}s forwards"` : ""}>
    ${n ? `<rect class="cover" x="${cmdX}" y="${y - FS - 2}" width="${W}" height="${LH}" fill="${C.bg}"/>` : ""}
    ${caret}
  </g>
</g>\n`;
      t += 0.35 + dur + 0.3;
    }
    y += kind === "out" && script[i + 1]?.[0] === "cmd" ? LH + 4 : LH;
  });
  return svg(W, H, `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${C.bg}" stroke="${C.border}"/>
<line x1="0" y1="34.5" x2="${W}" y2="34.5" stroke="${C.border}"/>
<circle cx="18" cy="17" r="5" fill="${C.border}"/><circle cx="36" cy="17" r="5" fill="${C.border}"/><circle cx="54" cy="17" r="5" fill="${C.border}"/>
<text x="${W / 2}" y="21" text-anchor="middle" class="mono" font-size="11" fill="${C.dim}">liwidale — zsh — 80×24</text>
<clipPath id="screen"><rect x="1" y="35" width="${W - 2}" height="${H - 36}" rx="7"/></clipPath>
<g clip-path="url(#screen)">
${body}</g>`, `
  .ln { opacity: 0; animation: show 0.01s forwards; }
  @keyframes show { to { opacity: 1; } }
  .gone { animation: hide 0.01s forwards; }
  @keyframes hide { to { opacity: 0; } }
  .blink { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  ${keyframes}
  @media (prefers-reduced-motion: reduce) { .ln { opacity: 1; } .cover { display: none; } .gone { opacity: 0; } }`);
}

const STAR = `M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z`;

function project(repo) {
  const W = 440, H = 150;
  const desc = wrap(repo.description ?? "", 56, 3)
    .map((l, i) => `<text x="20" y="${62 + i * 19}" class="sans" font-size="13" fill="${C.muted}">${esc(l)}</text>`).join("\n");
  const lang = repo.primaryLanguage;
  const tag = repo.latestRelease?.tagName;
  const tagW = tag ? tag.length * 7.2 + 18 : 0;
  let x = 20, meta = "";
  if (lang) {
    meta += `<circle cx="${x + 5}" cy="124" r="5" fill="${lang.color ?? C.muted}"/><text x="${x + 16}" y="128" class="mono" font-size="12" fill="${C.muted}">${esc(lang.name.toLowerCase())}</text>`;
    x += 16 + lang.name.length * 7.2 + 20;
  }
  meta += `<path d="${STAR}" transform="translate(${x} 116) scale(0.8)" fill="${C.muted}"/><text x="${x + 18}" y="128" class="mono" font-size="12" fill="${C.muted}">${num(repo.stargazerCount)}</text>`;
  x += 18 + String(repo.stargazerCount).length * 7.2 + 20;
  if (repo.licenseInfo?.spdxId && repo.licenseInfo.spdxId !== "NOASSERTION")
    meta += `<text x="${x}" y="128" class="mono" font-size="12" fill="${C.dim}">${esc(repo.licenseInfo.spdxId.toLowerCase())}</text>`;
  return svg(W, H, `<g class="card">
${frame(W, H, repo.name)}
${tag ? `<rect x="${W - 20 - tagW + 0.5}" y="17.5" width="${tagW}" height="22" rx="6" stroke="${C.border}"/><text x="${W - 20 - tagW / 2}" y="32.5" text-anchor="middle" class="mono" font-size="11.5" fill="${C.muted}">${esc(tag)}</text>` : ""}
${desc}
${meta}
</g>`);
}

function stats(user) {
  const W = 440, H = 200;
  const c = user.contributionsCollection;
  const repos = user.repositories.nodes.filter((r) => r.name !== LOGIN);
  const rows = [
    ["contributions · last year", c.contributionCalendar.totalContributions + c.restrictedContributionsCount],
    ["commits · last year", c.totalCommitContributions],
    ["stars earned", repos.reduce((s, r) => s + r.stargazerCount, 0)],
    ["public repositories", repos.length],
    ["followers", user.followers.totalCount],
  ];
  const body = rows.map(([label, value], i) => {
    const y = 74 + i * 25;
    return `${i ? `<line x1="20" y1="${y - 17.5}" x2="${W - 20}" y2="${y - 17.5}" stroke="${C.border}"/>` : ""}
<text x="20" y="${y}" class="sans" font-size="13" fill="${C.muted}">${label}</text>
<text x="${W - 20}" y="${y}" text-anchor="end" class="mono" font-size="13" fill="${C.text}">${num(value)}</text>`;
  }).join("\n");
  return svg(W, H, `<g class="card">\n${frame(W, H, "the numbers")}\n${body}\n</g>`);
}

function languages(user) {
  const W = 440, H = 200, BAR = W - 40;
  const total = new Map();
  for (const r of user.repositories.nodes) {
    if (r.name === LOGIN) continue;
    for (const { size, node } of r.languages.edges) {
      const cur = total.get(node.name) ?? { size: 0, color: node.color ?? C.muted };
      cur.size += size;
      total.set(node.name, cur);
    }
  }
  const all = [...total].sort((a, b) => b[1].size - a[1].size);
  const sum = all.reduce((s, [, v]) => s + v.size, 0) || 1;
  const top = all.slice(0, 5).map(([name, v]) => ({ name, color: v.color, pct: (v.size / sum) * 100 }));
  const rest = 100 - top.reduce((s, l) => s + l.pct, 0);
  if (rest >= 0.1) top.push({ name: "other", color: C.dim, pct: rest });

  let x = 20, bar = "";
  top.forEach((l, i) => {
    const w = (l.pct / 100) * BAR;
    bar += `<rect x="${x.toFixed(1)}" y="54" width="${Math.max(w - (i < top.length - 1 ? 2 : 0), 1).toFixed(1)}" height="8" fill="${l.color}"/>`;
    x += w;
  });
  const legend = top.map((l, i) => {
    const cx = 20 + (i % 2) * (BAR / 2), cy = 96 + Math.floor(i / 2) * 30;
    return `<circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color}"/>
<text x="${cx + 18}" y="${cy}" class="mono" font-size="12.5" fill="${C.text}">${esc(l.name.toLowerCase())}</text>
<text x="${cx + BAR / 2 - 24}" y="${cy}" text-anchor="end" class="mono" font-size="12.5" fill="${C.muted}">${l.pct.toFixed(1)}%</text>`;
  }).join("\n");
  return svg(W, H, `<g class="card">
${frame(W, H, "the languages")}
<clipPath id="bar"><rect x="20" y="54" width="${BAR}" height="8" rx="4"/></clipPath>
<g clip-path="url(#bar)">${bar}</g>
${legend}
</g>`);
}

const user = await query();
mkdirSync(join(OUT, "projects"), { recursive: true });
const files = { "terminal.svg": terminal(), "stats.svg": stats(user), "languages.svg": languages(user) };
for (const name of PROJECTS) {
  const repo = user.repositories.nodes.find((r) => r.name === name);
  if (repo) files[`projects/${name}.svg`] = project(repo);
}
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
console.log(`rendered ${Object.keys(files).length} files to ${OUT}`);
