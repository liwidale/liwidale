import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOGIN = "liwidale";
const PROJECTS = ["kumo", "liauth", "localhost", "dropzone", "claude-portable", "lolzteam-api-ts"];
const OUT = process.argv[2] ?? "dist";
const ART = JSON.parse(readFileSync(new URL("../assets/art.json", import.meta.url), "utf8"));
const TOKEN = process.env.GITHUB_TOKEN;

const C = { bg: "#0A0A0A", border: "#262626", text: "#EDEDED", muted: "#A1A1A1", dim: "#525252", key: "#F03038", blue: "#4C9DFF", green: "#3AD37E" };
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FS = 14.5, CW = FS * 0.6, LH = 22, COLS = 55;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => n.toLocaleString("en-US");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
<style>
  text { font-family: ${MONO}; }
  .in { animation: in 400ms ease-out both; }
  @keyframes in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
${body}
</svg>
`;

function api(path, body) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");
  return fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": LOGIN },
    body: body && JSON.stringify(body),
  });
}

async function query() {
  const res = await api("/graphql", {
    variables: { login: LOGIN },
    query: `query($login: String!) {
      user(login: $login) {
        createdAt
        followers { totalCount }
        repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST]) { totalCount }
        contributionsCollection { totalCommitContributions restrictedContributionsCount }
        repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
          nodes { name description stargazerCount primaryLanguage { name } latestRelease { tagName } }
        }
      }
    }`,
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user;
}

async function linesOfCode(repos) {
  let add = 0, del = 0;
  for (const { name } of repos) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await api(`/repos/${LOGIN}/${name}/stats/contributors`);
      if (res.status === 202) { await sleep(3000); continue; }
      if (!res.ok) break;
      const me = (await res.json()).find((c) => c.author?.login?.toLowerCase() === LOGIN);
      for (const w of me?.weeks ?? []) add += w.a, del += w.d;
      break;
    }
  }
  return { add, del };
}

function uptime(since) {
  const a = new Date(since), b = new Date();
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) months--;
  const anchor = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, a.getUTCDate()));
  const days = Math.floor((b - anchor) / 864e5), years = Math.floor(months / 12), m = months % 12;
  const unit = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;
  return [years && unit(years, "year"), unit(m, "month"), unit(days, "day")].filter(Boolean).join(", ");
}

const span = (text, fill, weight) => `<tspan fill="${fill}"${weight ? ` font-weight="${weight}"` : ""}>${esc(text)}</tspan>`;

function leader(key, value, width = COLS, valueSpans = span(value, C.text)) {
  const dots = Math.max(1, width - key.length - 2 - value.length - 1);
  return { len: key.length + 2 + dots + 1 + value.length, spans: span(`${key}: `, C.key) + span(".".repeat(dots), C.dim) + " " + valueSpans };
}

function info(user, repos, loc) {
  const stars = repos.reduce((s, r) => s + r.stargazerCount, 0);
  const commits = user.contributionsCollection.totalCommitContributions + user.contributionsCollection.restrictedContributionsCount;
  const rule = (title) => {
    const head = `— ${title} `;
    return { len: COLS, spans: span(head, C.blue) + span("─".repeat(COLS - head.length), C.border) };
  };
  const pair = (a, b) => {
    const l = leader(a[0], a[1], 28), r = leader(b[0], b[1], COLS - 31);
    return { len: l.len + 3 + r.len, spans: `${l.spans}${span(" | ", C.dim)}${r.spans}` };
  };
  const net = num(loc.add - loc.del), add = `${num(loc.add)}++`, del = `${num(loc.del)}--`;
  const locSpans = span(`${net} `, C.text) + span("( ", C.dim) + span(add, C.green) + span(", ", C.dim) + span(del, C.key) + span(" )", C.dim);
  return [
    { len: COLS, spans: span("liwidale", C.blue, 600) + span("@", C.dim) + span("Liwidale ", C.blue, 600) + span("─".repeat(COLS - 18), C.border) },
    null,
    leader("OS", "macOS, Windows, Linux"),
    leader("Uptime", uptime(user.createdAt)),
    leader("Host", "Computer Science student"),
    leader("Kernel", "Programmer, Web Designer"),
    leader("Focus", "Fast systems, beautiful interfaces"),
    null,
    leader("Languages.Code", "Rust, TypeScript, Swift, Kotlin"),
    leader("Languages.UI", "React, SwiftUI, Compose, egui"),
    leader("Languages.Real", "Russian, English"),
    leader("Desktop", "Electron, Tauri"),
    leader("Design", "Figma, Photoshop, Premiere, AE, Blender"),
    null,
    rule("Contact"),
    leader("Telegram", "t.me/liwidale"),
    leader("X", "@liwidale"),
    leader("Matrix", "@liwidale:matrix.org"),
    leader("Discord", "@liwidale"),
    null,
    rule("GitHub Stats"),
    pair(["Repos", `${repos.length} {Contributed: ${user.repositoriesContributedTo.totalCount}}`], ["Stars", num(stars)]),
    pair(["Commits", num(commits)], ["Followers", num(user.followers.totalCount)]),
    leader("Lines of Code", `${net} ( ${add}, ${del} )`, COLS, locSpans),
  ];
}

function card(user, repos, loc) {
  const W = 1000, PAD = 34, TOP = 50;
  const lines = info(user, repos, loc);
  const H = TOP + lines.length * LH + PAD - 6;
  const IX = W - PAD - COLS * CW;

  const artW = IX - PAD * 2 - 6, acw = artW / ART.cols, afs = acw / 0.6;
  const artH = Math.min(H - PAD * 2, artW * 0.97), alh = artH / ART.rows;
  const ax = PAD, ay = (H - artH) / 2 + alh * 0.8;
  let art = "";
  ART.lines.forEach((runs, y) => {
    let x = 0;
    for (const [fill, chars] of runs) {
      if (fill) art += `<text x="${(ax + x * acw).toFixed(1)}" y="${(ay + y * alh).toFixed(1)}" font-size="${afs.toFixed(2)}" fill="${fill}" textLength="${(chars.length * acw).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(chars)}</text>`;
      x += chars.length;
    }
    art += "\n";
  });

  const text = lines
    .map((l, i) => l && `<text x="${IX.toFixed(1)}" y="${TOP + i * LH}" font-size="${FS}" textLength="${(l.len * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${l.spans}</text>`)
    .filter(Boolean)
    .join("\n");

  return svg(W, H, `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<g class="in">
${art}</g>
${text}`);
}

function heading(title) {
  const W = 1000, H = 40, cols = Math.floor((W - 2) / CW), head = `— ${title} `;
  return svg(W, H, `<text x="1" y="26" font-size="${FS}" textLength="${(cols * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${span(head, C.blue)}${span("─".repeat(cols - head.length), C.border)}</text>`);
}

const clip = (text, max) => (text.length <= max ? text : text.slice(0, max - 1).replace(/[\s,.;:]+\S*$/, "") + "…");

function row(repo) {
  const W = 1000, H = 52, X = 24, cols = Math.floor((W - X * 2) / CW);
  const lang = repo.primaryLanguage?.name.toLowerCase() ?? "";
  const meta = [repo.latestRelease?.tagName, lang, `★ ${repo.stargazerCount}`].filter(Boolean).join(" · ") + "  →";
  const nameW = 20, dots = nameW - repo.name.length - 3;
  const desc = clip(repo.description ?? "", cols - nameW - meta.length - 3);
  const gap = Math.max(1, cols - 2 - repo.name.length - 1 - dots - 1 - desc.length - meta.length);
  const line = span("ゝ ", C.key) + span(repo.name, C.text, 600) + " " + span(".".repeat(dots), C.dim) + " " + span(desc, C.muted) + " ".repeat(gap) + span(meta, C.dim);
  return svg(W, H, `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${C.bg}" stroke="${C.border}"/>
<text x="${X}" y="31" font-size="${FS}" xml:space="preserve" textLength="${(cols * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${line}</text>`);
}

function viewAll(count) {
  const W = 1000, H = 52;
  return svg(W, H, `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${C.bg}" stroke="${C.border}"/>
<text x="${W / 2}" y="31" font-size="${FS}" text-anchor="middle">${span("ゝ ", C.key)}${span(`view all ${count} projects`, C.text, 600)}${span("  →", C.dim)}</text>`);
}

const user = await query();
const repos = user.repositories.nodes.filter((r) => r.name !== LOGIN);
const loc = await linesOfCode(repos);
mkdirSync(join(OUT, "projects"), { recursive: true });
const files = { "card.svg": card(user, repos, loc), "projects.svg": heading("Projects"), "projects/all.svg": viewAll(repos.length) };
for (const name of PROJECTS) {
  const repo = repos.find((r) => r.name === name);
  if (repo) files[`projects/${name}.svg`] = row(repo);
}
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
console.log(`rendered ${Object.keys(files).length} files to ${OUT}, loc +${loc.add} -${loc.del}`);
