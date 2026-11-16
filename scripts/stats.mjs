// Renders the profile cards (assets/*.svg) and the card blocks in README.md.
// Node 20+, no dependencies. Env: GH_TOKEN (required), GH_USER (default "liwidale").
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const USER = process.env.GH_USER || "liwidale";
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN is required.");
  process.exit(1);
}

// Liwidale dark tokens; the accent is Holo's hair color (5.5:1 on black).
const C = {
  canvas: "#000000", text: "#FFFFFF", muted: "#8F8F8F", subtle: "#5C5C5C",
  border: "#222222", strong: "#363636", divider: "#1A1A1A", accent: "#A87855",
};
const LANG_SHADES = [C.accent, "#D9D9D9", "#8F8F8F", "#5C5C5C", C.strong, C.border];
const SANS = "'Inter', 'Noto Sans JP', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', 'Noto Sans JP', ui-monospace, Menlo, Consolas, monospace";
const MARK = "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
const DAY = 86400000;
const RECENT = 6;
const CONTACTS = [
  ["TELEGRAM", "@liwidale", "https://t.me/liwidale"],
  ["X", "@liwidale", "https://x.com/liwidale"],
  ["YOUTUBE", "@liwidale", "https://www.youtube.com/@liwidale"],
  ["REDDIT", "u/liwidale", "https://www.reddit.com/user/liwidale/"],
  ["MATRIX", "@liwidale:matrix.org", "https://matrix.to/#/@liwidale:matrix.org"],
  ["DISCORD", "@liwidale", "https://discord.com/app"],
];

// ---------- data ----------

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

const profile = (await gql(`query($login:String!){ user(login:$login){
  login name bio location createdAt
  contributionsCollection{ totalCommitContributions
    contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } }
  repositories(ownerAffiliations:OWNER, privacy:PUBLIC, isFork:false, first:100, orderBy:{field:PUSHED_AT, direction:DESC}){
    totalCount
    nodes{ name description url pushedAt isArchived stargazerCount primaryLanguage{ name }
      languages(first:20, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name } } }
      defaultBranchRef{ target{ ... on Commit{ history(first:1){ totalCount nodes{ messageHeadline committedDate } } } } } } }
}}`, { login: USER })).user;

// All-time commits: one contributionsCollection per year since the account was created.
const now = new Date();
const created = new Date(profile.createdAt);
let allTimeCommits = 0;
for (let from = created; from < now; ) {
  const to = new Date(Math.min(now, new Date(from).setUTCFullYear(from.getUTCFullYear() + 1)));
  const { user } = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
    contributionsCollection(from:$from,to:$to){ totalCommitContributions } } }`,
    { login: USER, from: from.toISOString(), to: to.toISOString() });
  allTimeCommits += user.contributionsCollection.totalCommitContributions;
  from = to;
}

const cc = profile.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays)
  .map((d) => ({ date: new Date(`${d.date}T00:00:00Z`), count: d.contributionCount }));
const createdDay = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
const tracked = days.filter((d) => +d.date >= createdDay);
const activeDays = tracked.filter((d) => d.count > 0).length;
const activePct = tracked.length ? Math.round((activeDays / tracked.length) * 100) : 0;

// Weekday rhythm, Monday first.
const WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const byWeekday = Array(7).fill(0);
for (const d of tracked) byWeekday[(d.date.getUTCDay() + 6) % 7] += d.count;
const weekTotal = byWeekday.reduce((a, b) => a + b, 0);
const busiest = byWeekday.indexOf(Math.max(...byWeekday));
const quietest = byWeekday.indexOf(Math.min(...byWeekday));
const weekdaysPct = weekTotal ? Math.round((byWeekday.slice(0, 5).reduce((a, b) => a + b, 0) / weekTotal) * 100) : 0;

// Streaks.
let longest = 0, run = 0;
for (const d of days) { run = d.count ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1 - (days.at(-1)?.count ? 0 : 1); i >= 0 && days[i].count; i--) current++;
const lastActive = [...days].reverse().find((d) => d.count)?.date;

// Languages by bytes across public, non-fork repositories (this one excluded).
const repos = profile.repositories.nodes.filter((r) => r.name.toLowerCase() !== USER.toLowerCase());
const langBytes = new Map();
for (const r of repos) for (const e of r.languages.edges) langBytes.set(e.node.name, (langBytes.get(e.node.name) ?? 0) + e.size);
const langTotal = [...langBytes.values()].reduce((a, b) => a + b, 0) || 1;
const langs = [...langBytes].sort((a, b) => b[1] - a[1]).map(([name, size]) => ({ name, pct: (size / langTotal) * 100 }));
const topLangs = langs.slice(0, 5);
const otherPct = langs.slice(5).reduce((a, l) => a + l.pct, 0);
if (otherPct > 0.05) topLangs.push({ name: "Other", pct: otherPct });
const recent = repos.filter((r) => !r.isArchived).slice(0, RECENT);

// ---------- svg helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
const num = (n) => n.toLocaleString("en-US");
const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
const ago = (iso) => {
  const n = Math.floor((now - new Date(iso)) / DAY);
  return n < 1 ? "TODAY" : n === 1 ? "YESTERDAY" : n < 30 ? `${n} DAYS AGO` : fmtDate(new Date(iso));
};
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
function wrap(text, max, lines) {
  const out = [""];
  for (const word of text.split(/\s+/)) {
    const last = out.at(-1);
    if (last && `${last} ${word}`.length > max) out.push(word);
    else out[out.length - 1] = last ? `${last} ${word}` : word;
  }
  if (out.length > lines) out.splice(lines, Infinity, ...[]), (out[lines - 1] = clip(`${out[lines - 1]} …`, max));
  return out;
}
const artData = (name) => `data:image/webp;base64,${readFileSync(join(root, "assets", "art", name)).toString("base64")}`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const fontCache = new Map();
async function font(family, weight, text) {
  const chars = [...new Set(text)].filter((ch) => ch.trim()).sort().join("");
  if (!chars) return "";
  const key = `${family}${weight}${chars}`;
  if (fontCache.has(key)) return fontCache.get(key);
  let rule = "";
  try {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(chars)}`;
    const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
    const src = css.match(/url\((https:[^)]+)\)\s*format\('([a-z0-9]+)'\)/);
    if (!src) throw new Error("no font url");
    const bytes = Buffer.from(await (await fetch(src[1])).arrayBuffer());
    rule = `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/${src[2]};base64,${bytes.toString("base64")}) format('${src[2]}');}`;
  } catch (e) {
    console.warn(`Font ${family} ${weight} not embedded (${e.message}); falling back to system fonts.`);
  }
  fontCache.set(key, rule);
  return rule;
}

// Collects the text drawn with each font so every SVG embeds only the glyphs it uses.
function canvas() {
  const used = { light: "", regular: "", mono: "", jp: "" };
  const jp = (s) => s.replace(/[\x00-\x7F·…↗]/g, "");
  return {
    used,
    light: (s) => ((used.light += s), (used.jp += jp(s)), esc(s)),
    regular: (s) => ((used.regular += s), (used.jp += jp(s)), esc(s)),
    mono: (s) => ((used.mono += s), (used.jp += jp(s)), esc(s)),
    mark: () => ((used.jp += "ゝ"), "ゝ"),
  };
}

async function style(used) {
  const faces = await Promise.all([
    font("Inter", 300, used.light), font("Inter", 400, used.regular),
    font("Geist Mono", 400, used.mono), font("Noto Sans JP", 400, used.jp),
  ]);
  return `<style>${faces.join("")}
.l{font-family:${MONO};font-size:15px;letter-spacing:1.5px;fill:${C.muted}}
.v{font-family:${MONO};font-size:17px;letter-spacing:0.5px;fill:${C.text}}
.t{font-family:${SANS};font-weight:300;fill:${C.text}}
.r{font-family:${SANS};font-weight:400;fill:${C.muted}}
.m{font-family:${MARK};font-size:17px;fill:${C.accent}}
.a{fill:${C.accent}}
@keyframes fade{from{opacity:0}}
@keyframes rise{from{transform:scaleY(0)}}
@keyframes grow{from{transform:scaleX(0)}}
@keyframes drift{to{transform:scale(1.03)}}
.in{animation:fade .3s cubic-bezier(.16,1,.3,1) both}
.rise{transform-box:fill-box;transform-origin:50% 100%;animation:rise .6s cubic-bezier(.16,1,.3,1) both}
.grow{transform-box:fill-box;transform-origin:0 50%;animation:grow .6s cubic-bezier(.16,1,.3,1) both}
.drift{transform-box:fill-box;transform-origin:50% 50%;animation:drift 30s ease-in-out infinite alternate}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`;
}

// Faint glow for the few accent shapes (never text).
const GLOW = `<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feComponentTransfer in="b" result="s"><feFuncA type="linear" slope=".4"/></feComponentTransfer><feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

// Pure black card, 1 px hairline. Structure comes from space and type, not fills.
const GAP = 12;
const PAIRS = [["commits.svg", "languages.svg"], ["rhythm.svg", "activity.svg"], ...[0, 2, 4].map((i) => [`repos/${i + 1}.svg`, `repos/${i + 2}.svg`])];
const pairSide = (name) => {
  if (name.startsWith("contact/")) return CONTACTS.findIndex(([label]) => name === `contact/${label.toLowerCase()}.svg`) % 2 ? "right" : "left";
  const pair = PAIRS.find((p) => p.includes(name));
  return pair ? (pair[0] === name ? "left" : "right") : null;
};

async function svg(name, w, h, label, draw, { rx = 16 } = {}) {
  const k = canvas();
  const body = draw(k);
  const out = join(root, "assets", name);
  mkdirSync(dirname(out), { recursive: true });
  // Cards shown in pairs (50% + 50%) get a transparent strip on their inner side: the outer edges stay
  // flush with the full-width banners and the two strips form the gap between the cards.
  const side = pairSide(name), m = side ? GAP / 2 : 0, ow = w + m;
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${h}" viewBox="0 0 ${ow} ${h}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
${await style(k.used)}
<g transform="translate(${side === "right" ? m : 0} 0)">
<defs><clipPath id="clip"><rect width="${w}" height="${h}" rx="${rx}"/></clipPath>${GLOW}</defs>
<rect width="${w}" height="${h}" rx="${rx}" fill="${C.canvas}"/>
${body}
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx - 0.5}" fill="none" stroke="${C.border}"/>
</g>
</svg>
`);
}

// Transparent cut-out standing on the black: clipped by the card, fading out toward the card's bottom
// edge, with one thin accent ring behind the head (cx, cy, r in the image's own 0..1 space).
function cutout(file, x, y, w, h, cardH, head, sides = [0, 0]) {
  const [hx, hy] = head;
  return `<defs>
  <linearGradient id="cf" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${cardH * 0.48}" y2="${cardH - 6}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
  <mask id="cm"><rect width="100%" height="${cardH}" fill="url(#cf)"/></mask>
  <linearGradient id="sf" gradientUnits="userSpaceOnUse" x1="${x}" x2="${x + w}" y1="0" y2="0"><stop offset="0" stop-color="${sides[0] ? "#000" : "#fff"}"/><stop offset="${sides[0]}" stop-color="#fff"/><stop offset="${1 - sides[1]}" stop-color="#fff"/><stop offset="1" stop-color="${sides[1] ? "#000" : "#fff"}"/></linearGradient>
  <radialGradient id="bl" gradientUnits="userSpaceOnUse" cx="${x + hx * w}" cy="${y + hy * h}" r="${w * 0.62}"><stop offset="0" stop-color="${C.accent}" stop-opacity=".2"/><stop offset=".6" stop-color="${C.accent}" stop-opacity=".06"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
  <mask id="sm"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sf)"/></mask>
</defs>
<g clip-path="url(#clip)">
  <rect width="100%" height="${cardH}" fill="url(#bl)"/>
  <g mask="url(#cm)"><g mask="url(#sm)"><image class="in" href="${artData(file)}" x="${x}" y="${y}" width="${w}" height="${h}"/></g></g>
</g>`;
}

const W = 600, H = 320, P = 40;
rmSync(join(root, "assets", "repos"), { recursive: true, force: true });
rmSync(join(root, "assets", "contact"), { recursive: true, force: true });
const updated = fmtDate(now);
const title = (d) => WEEK[d][0] + WEEK[d].slice(1).toLowerCase();

// ---------- header ----------

await svg("header.svg", 1280, 440, `${profile.name || USER}. ${profile.bio ?? ""}`, (k) => {
  const meta = [profile.location, `SINCE ${created.getUTCFullYear()}`, `${profile.repositories.totalCount} REPOS`].filter(Boolean).map((s) => s.toUpperCase()).join("   ·   ");
  return `${cutout("holo-header.webp", 724, 6, 544, 600, 440, [0.55, 0.32])}
<text x="64" y="96" style="font-size:18px"><tspan class="m" style="font-size:inherit">${k.mark()}</tspan><tspan class="l" dx="10" style="font-size:inherit">${k.mono("INDEPENDENT DEVELOPER")}</tspan></text>
<text class="t" x="58" y="236" font-size="128" letter-spacing="-5">${k.light(USER)}</text>
${profile.bio ? `<text class="r" x="64" y="286" font-size="22" letter-spacing="-0.1">${k.regular(profile.bio)}</text>` : ""}
<line x1="64" x2="648" y1="346" y2="346" stroke="${C.divider}"/>
<text class="l" x="64" y="384" style="font-size:16px">${k.mono(meta)}</text>
<text class="l" x="648" y="384" text-anchor="end" style="font-size:16px"><tspan class="a">●</tspan><tspan dx="8">${k.mono(updated)}</tspan></text>`;
});

// ---------- stats ----------

await svg("commits.svg", W, H, `${num(cc.totalCommitContributions)} commits in the last 12 months, ${num(allTimeCommits)} all time. Active on ${activePct}% of days.`, (k) => {
  const cx = 452, cy = 172, r = 78, len = 2 * Math.PI * r, on = (len * activePct) / 100;
  return `
<text class="l" x="${P}" y="58">${k.mono("COMMITS")}</text>
<text class="t" x="${P - 5}" y="196" font-size="112" letter-spacing="-4">${k.light(num(cc.totalCommitContributions))}</text>
<text class="l" x="${P}" y="236">${k.mono("LAST 12 MONTHS")}</text>
<text class="l" x="${P}" y="280">${k.mono("ALL TIME")}<tspan class="v" dx="14">${k.mono(num(allTimeCommits))}</tspan></text>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.divider}" stroke-width="4"/>
<circle class="in" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.accent}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${on.toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" filter="url(#glow)"/>
<text class="t" x="${cx}" y="${cy + 6}" font-size="44" letter-spacing="-1.5" text-anchor="middle">${k.light(`${activePct}%`)}</text>
<text class="l" x="${cx}" y="${cy + 34}" text-anchor="middle" style="font-size:13px">${k.mono("ACTIVE DAYS")}</text>
<text class="l" x="${cx}" y="280" text-anchor="middle">${k.mono(`${activeDays} / ${tracked.length}`)}</text>`;
});

await svg("languages.svg", W, H, `Languages: ${topLangs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", ")}.`, (k) => {
  const lead = topLangs[0] ?? { name: "—", pct: 0 };
  const barW = W - 2 * P, y = 186, gap = 4;
  let x = P;
  const segs = topLangs.map((l, i) => {
    const w = Math.max(2, (barW * l.pct) / 100 - gap);
    const s = `<rect class="grow" style="animation-delay:${i * 30}ms" x="${x.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="4" rx="2" fill="${LANG_SHADES[i]}"${i === 0 ? ' filter="url(#glow)"' : ""}/>`;
    x += w + gap;
    return s;
  }).join("");
  const rows = topLangs.slice(1, 5).map((l, i) => {
    const cx = P + (i % 2) * (barW / 2 + 16), cy = 240 + Math.floor(i / 2) * 36, right = cx + barW / 2 - 16;
    return `<text class="r" x="${cx}" y="${cy}" font-size="16">${k.regular(l.name)}</text>
<text class="l" x="${right}" y="${cy}" text-anchor="end">${k.mono(l.pct.toFixed(1))}</text>`;
  }).join("\n");
  return `
<text class="l" x="${P}" y="58">${k.mono("LANGUAGES")}</text>
<text class="l" x="${W - P}" y="58" text-anchor="end">${k.mono(lead.name.toUpperCase())}</text>
<text class="t" x="${P - 5}" y="150" font-size="80" letter-spacing="-3">${k.light(lead.pct.toFixed(1))}<tspan style="fill:${C.subtle}" font-size="40" dx="6">${k.light("%")}</tspan></text>
${segs}
${rows}`;
});

await svg("rhythm.svg", W, H, `Weekly rhythm. Busiest day ${WEEK[busiest]}, quietest ${WEEK[quietest]}, ${weekdaysPct}% on weekdays.`, (k) => {
  const max = Math.max(...byWeekday, 1), base = 236, top = 96, bw = 8, gap = 40;
  const cols = byWeekday.map((v, i) => {
    const cx = P + 4 + i * gap, h = Math.max(2, ((base - top) * v) / max), hot = i === busiest;
    return `<rect class="rise" style="animation-delay:${i * 30}ms" x="${cx - bw / 2}" y="${base - h}" width="${bw}" height="${h}" rx="4" fill="${hot ? C.accent : C.strong}"${hot ? ' filter="url(#glow)"' : ""}/>
<text class="l" x="${cx}" y="${base + 40}" text-anchor="middle"${hot ? ` style="fill:${C.text}"` : ""}>${k.mono(WEEK[i][0])}</text>`;
  }).join("\n");
  const sx = 360;
  const row = (y, label, value) => `<text class="l" x="${sx}" y="${y}">${k.mono(label)}</text><text class="t" x="${W - P}" y="${y}" font-size="26" text-anchor="end" letter-spacing="-0.5">${k.light(value)}</text>`;
  return `
<text class="l" x="${P}" y="58">${k.mono("WEEKLY RHYTHM")}</text>
${cols}
${row(140, "BUSIEST", title(busiest))}
<line x1="${sx}" x2="${W - P}" y1="164" y2="164" stroke="${C.divider}"/>
${row(204, "QUIETEST", title(quietest))}
<line x1="${sx}" x2="${W - P}" y1="228" y2="228" stroke="${C.divider}"/>
${row(268, "WEEKDAYS", `${weekdaysPct}%`)}`;
});

await svg("activity.svg", W, H, `Activity over the last 26 weeks. Current streak ${current} days, longest ${longest} days.`, (k) => {
  const weeks = cc.contributionCalendar.weeks.slice(-26), cols = weeks.length, gap = 5;
  const step = (W - 2 * P + gap) / 26, cell = step - gap, y0 = 82;
  const max = Math.max(1, ...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));
  const shown = weeks.reduce((a, w) => a + w.contributionDays.reduce((b, d) => b + d.contributionCount, 0), 0);
  const lastKey = lastActive?.toISOString().slice(0, 10);
  const cells = weeks.flatMap((w, c) => w.contributionDays.map((d) => {
    const v = d.contributionCount;
    const x = (P + (c + 26 - cols) * step).toFixed(2), y = (y0 + new Date(`${d.date}T00:00:00Z`).getUTCDay() * step).toFixed(2);
    const box = `x="${x}" y="${y}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="2"`;
    if (!v) return `<rect ${box} fill="${C.divider}"/>`;
    if (d.date === lastKey) return `<rect ${box} fill="${C.accent}" filter="url(#glow)"/>`;
    return `<rect class="in" style="animation-delay:${c * 12}ms" ${box} fill="#FFFFFF" fill-opacity="${(0.25 + 0.65 * Math.min(1, v / max)).toFixed(2)}"/>`;
  })).join("");
  const stat = (x, label, value) => `<text class="t" x="${x - 1}" y="264" font-size="26" letter-spacing="-0.5">${k.light(value)}</text><text class="l" x="${x}" y="290">${k.mono(label)}</text>`;
  return `
<text class="l" x="${P}" y="58">${k.mono("LAST 26 WEEKS")}</text>
<text class="l" x="${W - P}" y="58" text-anchor="end">${k.mono(`${num(shown)} CONTRIBUTIONS`)}</text>
${cells}
${stat(P, "STREAK", `${current}d`)}
${stat(P + 150, "LONGEST", `${longest}d`)}
${stat(P + 300, "LAST ACTIVE", lastActive ? lastActive.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—")}`;
});

// ---------- sections ----------

const strip = (file, index, name, note) => svg(file, 1280, 120, name, (k) => `
<text class="l" x="56" y="70"><tspan class="a">${k.mono(index)}</tspan></text>
<text class="t" x="110" y="76" font-size="40" letter-spacing="-1.2">${k.light(name)}</text>
<text class="l" x="1224" y="70" text-anchor="end">${k.mono(note)}</text>`);

await svg("projects.svg", 1280, 220, "Recent repositories", (k) => `${cutout("holo-repos.webp", 900, 0, 330, 330, 220, [0.55, 0.32])}
<text class="l" x="56" y="78"><tspan class="a">${k.mono("01")}</tspan></text>
<text class="t" x="110" y="86" font-size="48" letter-spacing="-1.5">${k.light("Recent repositories")}</text>
<text class="l" x="112" y="150">${k.mono(`${recent.length} OF ${repos.length}  ·  SORTED BY LAST PUSH  ·  REFRESHED DAILY`)}</text>`);

for (const [i, r] of recent.entries()) {
  const total = r.defaultBranchRef?.target?.history?.totalCount;
  await svg(`repos/${i + 1}.svg`, W, 220, `${r.name}: ${r.description ?? ""}`, (k) => {
    const desc = wrap(r.description ?? "No description yet.", 56, 2);
    const facts = [total ? `${num(total)} ${total === 1 ? "COMMIT" : "COMMITS"}` : null, r.stargazerCount ? `★ ${r.stargazerCount}` : null, `UPDATED ${ago(r.pushedAt)}`].filter(Boolean).join("   ·   ");
    return `
<text class="l" x="${P}" y="56">${k.mono(String(i + 1).padStart(2, "0"))}</text>
<text class="l" x="${W - P}" y="56" text-anchor="end">${r.primaryLanguage ? `<tspan class="a">●</tspan><tspan dx="8">${k.mono(r.primaryLanguage.name.toUpperCase())}</tspan>` : ""}</text>
<text class="t" x="${P - 2}" y="104" font-size="34" letter-spacing="-1">${k.light(clip(r.name, 26))}</text>
${desc.map((line, j) => `<text class="r" x="${P}" y="${136 + j * 22}" font-size="15">${k.regular(line)}</text>`).join("\n")}
<text class="l" x="${P}" y="194" style="font-size:13px">${k.mono(facts)}</text>`;
  });
}

await strip("contact.svg", "02", "Contact", `${CONTACTS.length} CHANNELS`);

for (const [label, handle] of CONTACTS) {
  await svg(`contact/${label.toLowerCase()}.svg`, W, 96, `${label.toLowerCase()} ${handle}`, (k) => `
<text class="l" x="${P}" y="56">${k.mono(label)}</text>
<text class="t" x="200" y="57" font-size="22" letter-spacing="-0.3">${k.light(handle)}</text>
<text class="r" x="${W - P}" y="57" font-size="20" text-anchor="end">${k.regular("↗")}</text>`);
}

await svg("footer.svg", 1280, 360, "Every commit is one more iteration.", (k) => `${cutout("holo-footer.webp", 60, 10, 480, 533, 360, [0.55, 0.22], [0.2, 0])}
<text x="600" y="96" style="font-size:18px"><tspan class="m" style="font-size:inherit">${k.mark()}</tspan><tspan class="l" dx="10" style="font-size:inherit">${k.mono("ONE MORE ITERATION")}</tspan></text>
<text class="t" x="596" y="180" font-size="52" letter-spacing="-1.8">${k.light("Every commit is")}</text>
<text class="t" x="596" y="240" font-size="52" letter-spacing="-1.8" style="fill:${C.subtle}">${k.light("one more iteration.")}</text>
<line x1="600" x2="1216" y1="290" y2="290" stroke="${C.divider}"/>
<text class="l" x="600" y="320" style="font-size:13px">${k.mono("ART · HOLO, SPICE AND WOLF · FAN ART BY LIKUNEA")}</text>`);

// ---------- README ----------

const readmePath = join(root, "README.md");
const block = (name, html) => (s) => s.replace(new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`), `$1\n${html}\n$2`);
// Two linked cards back to back (no whitespace between them), one pair per line.
const pairs = (cards) => cards.reduce((rows, c, i) => (i % 2 ? (rows[rows.length - 1] += c) : rows.push(c), rows), []).join("\n");
const repoCards = pairs(recent.map((r, i) => `<a href="${r.url}"><img width="50%" alt="${esc(`${r.name}: ${r.description ?? ""}`)}" src="assets/repos/${i + 1}.svg"></a>`));
const contactCards = pairs(CONTACTS.map(([label, handle, url]) => `<a href="${url}"><img width="50%" alt="${esc(`${label.toLowerCase()} ${handle}`)}" src="assets/contact/${label.toLowerCase()}.svg"></a>`));
const readme = [block("projects", repoCards), block("contact", contactCards)].reduce((s, f) => f(s), readFileSync(readmePath, "utf8"));
writeFileSync(readmePath, readme);

console.log(`Rendered for ${USER}: ${cc.totalCommitContributions} commits (12 mo), ${allTimeCommits} all time, ${activePct}% active, ${langs.length} languages, ${recent.length} recent repos.`);
