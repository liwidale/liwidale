import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LOGIN = "liwidale";
const SLOTS = 6;
const CONTACTS = [
  ["telegram", "Telegram", "@liwidale"],
  ["x", "X", "@liwidale"],
  ["youtube", "YouTube", "@liwidale"],
  ["reddit", "Reddit", "u/liwidale"],
  ["matrix", "Matrix", "@liwidale:matrix.org"],
  ["discord", "Discord", "@liwidale"],
];
const OUT = process.argv[2] ?? "dist";
const asset = (name) => JSON.parse(readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8"));
const ART = asset("art.json");
const ICONS = asset("icons.json");
const TOKEN = process.env.GITHUB_TOKEN;

const C = { bg: "#0A0A0A", border: "#262626", text: "#EDEDED", muted: "#A1A1A1", dim: "#525252", key: "#F03038", blue: "#4C9DFF", green: "#3AD37E", star: "#E3B341", pill: "#141414" };
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
          nodes { name description stargazerCount primaryLanguage { name color } latestRelease { tagName } }
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

const clip = (text, max) => (text.length <= max ? text : text.slice(0, Math.max(0, max - 1)).replace(/[\s,.;:]+\S*$/, "") + "…");
const box = (W, H) => `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${C.bg}" stroke="${C.border}"/>`;
const glyph = (d, x, y, size, from, fill) => `<path d="${d}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(size / from).toFixed(4)})" fill="${fill}"/>`;

function pill(label, { icon, iconFill, dot, text = C.text }) {
  const lead = icon || dot ? 21 : 0, w = 12 + lead + label.length * CW + 12, PH = 28;
  return {
    w,
    at: (x, H) => {
      const y = (H - PH) / 2;
      let out = `<rect x="${(x + 0.5).toFixed(1)}" y="${y + 0.5}" width="${w.toFixed(1)}" height="${PH - 1}" rx="6" fill="${C.pill}" stroke="${C.border}"/>`;
      if (icon) out += glyph(icon, x + 12, H / 2 - 7, 14, ICONS.size.octicon, iconFill);
      if (dot) out += `<circle cx="${(x + 18).toFixed(1)}" cy="${H / 2}" r="5" fill="${dot}"/>`;
      return out + `<text x="${(x + 12 + lead).toFixed(1)}" y="${H / 2 + 5}" font-size="${FS - 1}" fill="${text}" textLength="${(label.length * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>`;
    },
  };
}

function row(repo) {
  const W = 1000, H = 52, X = 24, GAP = 8;
  const pills = [pill(String(repo.stargazerCount), { icon: ICONS.octicon["star-fill"], iconFill: C.star })];
  if (repo.latestRelease) pills.push(pill(repo.latestRelease.tagName, { icon: ICONS.octicon.tag, iconFill: C.blue }));
  if (repo.primaryLanguage) pills.push(pill(repo.primaryLanguage.name.toLowerCase(), { dot: repo.primaryLanguage.color ?? C.muted, text: C.muted }));
  let x = W - 14, right = "";
  for (const p of pills) { x -= p.w; right = p.at(x, H) + right; x -= GAP; }
  const cols = Math.floor((x - X - 12) / CW), nameW = 20, dots = Math.max(1, nameW - repo.name.length - 3);
  const desc = clip(repo.description ?? "", cols - 2 - repo.name.length - 1 - dots - 1);
  const len = 2 + repo.name.length + 1 + dots + 1 + desc.length;
  const line = span("ゝ ", C.key) + span(repo.name, C.text, 600) + " " + span(".".repeat(dots), C.dim) + " " + span(desc, C.muted);
  return svg(W, H, `${box(W, H)}
<text x="${X}" y="31" font-size="${FS}" xml:space="preserve" textLength="${(len * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${line}</text>
${right}`);
}

function contact([id, name, handle]) {
  const W = 490, H = 52, X = 54, cols = Math.floor((W - 20 - X) / CW);
  const dots = Math.max(1, cols - name.length - handle.length - 2);
  const line = span(name, C.text, 600) + " " + span(".".repeat(dots), C.dim) + " " + span(handle, C.muted);
  return svg(W, H, `${box(W, H)}
${glyph(ICONS.brand[id], 20, H / 2 - 10, 20, ICONS.size.brand, C.text)}
<text x="${X}" y="31" font-size="${FS}" xml:space="preserve" textLength="${(cols * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${line}</text>`);
}

function viewAll(count) {
  const W = 1000, H = 52;
  return svg(W, H, `${box(W, H)}
<text x="${W / 2}" y="31" font-size="${FS}" text-anchor="middle">${span("ゝ ", C.key)}${span(`view all ${count} projects`, C.text, 600)}</text>`);
}

const redirect = (url, title) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta http-equiv="refresh" content="0; url=${esc(url)}">
<link rel="canonical" href="${esc(url)}">
<a href="${esc(url)}">${esc(title)}</a>
</html>
`;

const user = await query();
const repos = user.repositories.nodes.filter((r) => r.name !== LOGIN);
const top = [...repos].sort((a, b) => b.stargazerCount - a.stargazerCount).slice(0, SLOTS);
const loc = await linesOfCode(repos);
const files = {
  "card.svg": card(user, repos, loc),
  "projects.svg": heading("Projects"),
  "contact.svg": heading("Contact"),
  "projects/all.svg": viewAll(repos.length),
};
top.forEach((repo, i) => {
  files[`projects/${i + 1}.svg`] = row(repo);
  files[`go/${i + 1}/index.html`] = redirect(`https://github.com/${LOGIN}/${repo.name}`, repo.name);
});
for (const c of CONTACTS) files[`contact/${c[0]}.svg`] = contact(c);
for (const [name, content] of Object.entries(files)) {
  mkdirSync(dirname(join(OUT, name)), { recursive: true });
  writeFileSync(join(OUT, name), content);
}
console.log(`rendered ${Object.keys(files).length} files to ${OUT}: ${top.map((r) => `${r.name} ${r.stargazerCount}`).join(", ")}`);
