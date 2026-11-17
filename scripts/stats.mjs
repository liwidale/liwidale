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

async function svg(name, w, h, label, draw, { rx = 16, over = 0 } = {}) {
  const k = canvas();
  const body = draw(k);
  const out = join(root, "assets", name);
  mkdirSync(dirname(out), { recursive: true });
  // Cards shown in pairs (50% + 50%) get a transparent strip on their inner side: the outer edges stay
  // flush with the full-width banners and the two strips form the gap between the cards.
  const side = pairSide(name), m = side ? GAP / 2 : 0, ow = w + m;
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${h + over}" viewBox="0 0 ${ow} ${h + over}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
${await style(k.used)}
<g transform="translate(${side === "right" ? m : 0} ${over})">
<defs><clipPath id="clip"><rect width="${w}" height="${h}" rx="${rx}"/></clipPath>${GLOW}</defs>
<rect width="${w}" height="${h}" rx="${rx}" fill="${C.canvas}"/>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx - 0.5}" fill="none" stroke="${C.border}"/>
${body}
</g>
</svg>
`);
}

// Transparent cut-out standing on the black: clipped by the card (and by the band above it when `over`
// is set, so the ears break out of the frame), fading out toward the card's bottom edge, with a soft
// accent backlight behind the head (hx, hy in the image's own 0..1 space).
function cutout(file, x, y, w, h, cardH, head, sides = [0, 0], over = 0) {
  const [hx, hy] = head;
  return `<defs>
  <linearGradient id="cf" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${cardH * 0.48}" y2="${cardH - 6}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
  <mask id="cm"><rect y="${-over}" width="100%" height="${cardH + over}" fill="url(#cf)"/></mask>
  <clipPath id="cc"><rect width="100%" height="${cardH}" rx="16"/>${over ? `<rect x="${x}" y="${-over}" width="${w}" height="${over + 16}"/>` : ""}</clipPath>
  <linearGradient id="sf" gradientUnits="userSpaceOnUse" x1="${x}" x2="${x + w}" y1="0" y2="0"><stop offset="0" stop-color="${sides[0] ? "#000" : "#fff"}"/><stop offset="${sides[0]}" stop-color="#fff"/><stop offset="${1 - sides[1]}" stop-color="#fff"/><stop offset="1" stop-color="${sides[1] ? "#000" : "#fff"}"/></linearGradient>
  <radialGradient id="bl" gradientUnits="userSpaceOnUse" cx="${x + hx * w}" cy="${y + hy * h}" r="${w * 0.62}"><stop offset="0" stop-color="${C.accent}" stop-opacity=".2"/><stop offset=".6" stop-color="${C.accent}" stop-opacity=".06"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
  <mask id="sm"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sf)"/></mask>
</defs>
<g clip-path="url(#clip)"><rect width="100%" height="${cardH}" fill="url(#bl)"/></g>
<g clip-path="url(#cc)"><g mask="url(#cm)"><g mask="url(#sm)"><image class="in" href="${artData(file)}" x="${x}" y="${y}" width="${w}" height="${h}"/></g></g></g>`;
}

const W = 600, H = 320, P = 40;
rmSync(join(root, "assets", "repos"), { recursive: true, force: true });
rmSync(join(root, "assets", "contact"), { recursive: true, force: true });
const updated = fmtDate(now);
const title = (d) => WEEK[d][0] + WEEK[d].slice(1).toLowerCase();

// ---------- header ----------

await svg("header.svg", 1280, 440, `${profile.name || USER}. ${profile.bio ?? ""}`, (k) => {
  const meta = [profile.location, `SINCE ${created.getUTCFullYear()}`, `${profile.repositories.totalCount} REPOS`].filter(Boolean).map((s) => s.toUpperCase()).join("   ·   ");
  return `${cutout("holo-header.webp", 700, -38, 580, 640, 440, [0.55, 0.32], [0, 0], 40)}
<text x="64" y="96" style="font-size:18px"><tspan class="m" style="font-size:inherit">${k.mark()}</tspan><tspan class="l" dx="10" style="font-size:inherit">${k.mono("INDEPENDENT DEVELOPER")}</tspan></text>
<text class="t" x="58" y="236" font-size="128" letter-spacing="-5">${k.light(USER)}</text>
${profile.bio ? `<text class="r" x="64" y="286" font-size="22" letter-spacing="-0.1">${k.regular(profile.bio)}</text>` : ""}
<line x1="64" x2="648" y1="346" y2="346" stroke="${C.divider}"/>
<text class="l" x="64" y="384" style="font-size:16px">${k.mono(meta)}</text>
<text class="l" x="648" y="384" text-anchor="end" style="font-size:16px"><tspan class="a">●</tspan><tspan dx="8">${k.mono(updated)}</tspan></text>`;
}, { over: 40 });

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

// Facts row in 13 px Geist Mono: advance 0.6 em + 1.5 px tracking per character. Pieces are separated by a
// wave dash; a piece may start with an icon (24-unit path drawn at 15 px, its corners rounded by a stroke
// of the same color, centered on the caps of the text).
const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z";
const ADV = 13 * 0.6 + 1.5;
function factsRow(k, parts, x, y) {
  let cx = x;
  return parts.map((part, i) => {
    let out = "";
    if (i) {
      out += `<text class="l" x="${(cx + 12).toFixed(1)}" y="${y}" style="font-size:13px">${k.mono("〜")}</text>`;
      cx += 12 + 14.5 + 12;
    }
    if (part.icon) {
      out += `<path transform="translate(${cx.toFixed(1)} ${(y - 12.4).toFixed(1)}) scale(.625)" d="${part.icon}" fill="${C.muted}" stroke="${C.muted}" stroke-width="2.6" stroke-linejoin="round"/>`;
      cx += 15 + 7;
    }
    out += `<text class="l" x="${cx.toFixed(1)}" y="${y}" style="font-size:13px">${k.mono(part.text)}</text>`;
    cx += part.text.length * ADV;
    return out;
  }).join("");
}

for (const [i, r] of recent.entries()) {
  const total = r.defaultBranchRef?.target?.history?.totalCount;
  await svg(`repos/${i + 1}.svg`, W, 220, `${r.name}: ${r.description ?? ""}`, (k) => {
    const desc = wrap(r.description ?? "No description yet.", 56, 2);
    const facts = [
      total ? { text: `${num(total)} ${total === 1 ? "COMMIT" : "COMMITS"}` } : null,
      r.stargazerCount ? { icon: STAR, text: String(r.stargazerCount) } : null,
      { text: `UPDATED ${ago(r.pushedAt)}` },
    ].filter(Boolean);
    return `
<text class="l" x="${P}" y="56">${k.mono(String(i + 1).padStart(2, "0"))}</text>
<text class="l" x="${W - P}" y="56" text-anchor="end">${r.primaryLanguage ? `<tspan class="a">●</tspan><tspan dx="8">${k.mono(r.primaryLanguage.name.toUpperCase())}</tspan>` : ""}</text>
<text class="t" x="${P - 2}" y="104" font-size="34" letter-spacing="-1">${k.light(clip(r.name, 26))}</text>
${desc.map((line, j) => `<text class="r" x="${P}" y="${136 + j * 22}" font-size="15">${k.regular(line)}</text>`).join("\n")}
${factsRow(k, facts, P, 194)}`;
  });
}

await strip("contact.svg", "02", "Contact", `${CONTACTS.length} CHANNELS`);

// Brand logos from Simple Icons (CC0, simple-icons@13.21.0), drawn monochrome white on the black cards.
const BRANDS = {
  telegram: ["#FFFFFF", "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"],
  x: ["#FFFFFF", "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"],
  youtube: ["#FFFFFF", "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"],
  reddit: ["#FFFFFF", "M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"],
  matrix: ["#FFFFFF", "M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.481.314.448.208.785.582 1.02 1.108.254-.374.6-.706 1.034-.992.434-.287.95-.43 1.546-.43.453 0 .872.056 1.26.167.388.11.716.286.993.53.276.245.489.559.646.951.152.392.23.863.23 1.417v5.728h-2.349V11.52c0-.286-.01-.559-.032-.812a1.755 1.755 0 0 0-.18-.66 1.106 1.106 0 0 0-.438-.448c-.194-.11-.457-.166-.785-.166-.332 0-.6.064-.803.189a1.38 1.38 0 0 0-.48.499 1.946 1.946 0 0 0-.231.696 5.56 5.56 0 0 0-.06.785v4.768h-2.35v-4.8c0-.254-.004-.503-.018-.752a2.074 2.074 0 0 0-.143-.688 1.052 1.052 0 0 0-.415-.503c-.194-.125-.476-.19-.854-.19-.111 0-.259.024-.439.074-.18.051-.36.143-.53.282-.171.138-.319.337-.439.595-.12.259-.18.6-.18 1.02v4.966H5.46V7.81zm15.693 15.64V.55H21.72V0H24v24h-2.28v-.55z"],
  discord: ["#FFFFFF", "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"],
};
for (const [label, handle] of CONTACTS) {
  const [color, d] = BRANDS[label.toLowerCase()];
  await svg(`contact/${label.toLowerCase()}.svg`, W, 96, `${label.toLowerCase()} ${handle}`, (k) => `
<path transform="translate(${P} 34) scale(1.17)" d="${d}" fill="${color}"/>
<text class="t" x="${P + 46}" y="57" font-size="22" letter-spacing="-0.3">${k.light(handle)}</text>
<text class="r" x="${W - P}" y="57" font-size="20" text-anchor="end">${k.regular("↗")}</text>`);
}

await svg("footer.svg", 1280, 360, "Every commit is one more iteration.", (k) => `${cutout("holo-footer.webp", 0, -40, 500, 556, 360, [0.45, 0.22], [0, 0], 48)}
<text x="600" y="96" style="font-size:18px"><tspan class="m" style="font-size:inherit">${k.mark()}</tspan><tspan class="l" dx="10" style="font-size:inherit">${k.mono("ONE MORE ITERATION")}</tspan></text>
<text class="t" x="596" y="180" font-size="52" letter-spacing="-1.8">${k.light("Every commit is")}</text>
<text class="t" x="596" y="240" font-size="52" letter-spacing="-1.8" style="fill:${C.subtle}">${k.light("one more iteration.")}</text>
<line x1="600" x2="1216" y1="290" y2="290" stroke="${C.divider}"/>
<text class="l" x="600" y="320" style="font-size:13px">${k.mono("ART · HOLO, SPICE AND WOLF · FAN ART BY LIKUNEA")}</text>`, { over: 48 });

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
