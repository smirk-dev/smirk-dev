#!/usr/bin/env node
// Renders the README "circuit board" as a stack of SVG cards in cards/board/.
//
// One SVG per clickable piece: a GitHub README shows an SVG as a plain image,
// so links inside an SVG never work. Each card is wrapped in its own <a> in
// README.md instead (hero, the three connector pads, each project row, each
// achievement stamp).
//
// Data: the GitHub GraphQL API (built-in GITHUB_TOKEN) plus cards the same
// workflow already built (stats.svg for commits/PRs/stars/rank, top-langs.svg,
// kaggle-badges.svg) and the achievement gallery pages.
//
// Safety: every card is built independently. A card whose data is missing is
// skipped, so the last good copy committed in the repo keeps rendering. If the
// contribution calendar can't be fetched at all, nothing is written.
//
// Fonts: JetBrains Mono and Rajdhani are fetched from Google Fonts subset to
// exactly the characters each card uses (a few KB) and embedded as base64, since
// an SVG shown through <img> cannot load web fonts. If that fetch fails the card
// still renders with a system monospace font.
//
// Usage: GITHUB_TOKEN=... node scripts/board.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const CFG = JSON.parse(await readFile(join(ROOT, "scripts/board.config.json"), "utf8"));
const OUT = join(ROOT, "cards/board");
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

const K = {
  page: "#0d1117", panel: "#0b0713", deep: "#08050f", border: "#2f1a4d", chip: "#15101f", chipBorder: "#3d2763",
  accent: "#B347FF", cyan: "#00E5FF", pink: "#FF3DCB", amber: "#FFB020", gold: "#c9a24a", hole: "#5b3a85",
  text: "#c9d1d9", muted: "#8b949e", white: "#ffffff", lilac: "#f3dcff",
};
const MONO = "JBM, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const DISP = "RJD, Rajdhani, JBM, ui-monospace, Consolas, monospace";
const LANG_COLOR = { Python: K.accent, TypeScript: K.cyan, JavaScript: K.pink, CSS: K.amber, HTML: "#7C5CFF", Dart: K.muted };

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const num = (x) => Number(x).toLocaleString("en-US");
const short = (x) => (x >= 10000 ? (x / 1000).toFixed(1).replace(/\.0$/, "") + "K" : num(x));
const clip = (s, max) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dlabel = (iso) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-board" },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.errors) return body.data;
    console.error(`GraphQL attempt ${attempt} failed: ${res.status} ${JSON.stringify(body.errors || body).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error("GraphQL failed after 3 attempts");
}

const fontCache = new Map();
async function fontFaces(family, alias, weights, chars) {
  const text = [...new Set(chars)].sort().join("");
  const key = `${family}|${weights}|${text}`;
  if (fontCache.has(key)) return fontCache.get(key);
  let css = "";
  try {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weights.join(";")}&text=${encodeURIComponent(text)}&display=block`;
    const sheet = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" } })).text();
    for (const block of sheet.match(/@font-face\s*{[^}]*}/g) || []) {
      const w = (block.match(/font-weight:\s*(\d+)/) || [])[1];
      const src = (block.match(/url\((https:[^)]+)\)/) || [])[1];
      if (!w || !src) continue;
      const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
      if (buf.length < 200) continue;
      css += `@font-face{font-family:${alias};font-weight:${w};src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2')}`;
    }
  } catch (e) {
    console.error(`font ${family} unavailable, falling back to system fonts: ${e.message}`);
  }
  fontCache.set(key, css);
  return css;
}

// Shared defs/styles; fonts subset to the text that actually appears.
async function card(w, h, title, body, extraCss = "") {
  const mono = new Set("0123456789 ");
  const disp = new Set();
  for (const [, attrs, inner] of body.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)) {
    const s = unesc(inner.replace(/<[^>]+>/g, ""));
    const target = /class="[^"]*\bd\b/.test(attrs) ? disp : mono;
    for (const ch of s) target.add(ch);
  }
  let faces = await fontFaces("JetBrains Mono", "JBM", [400, 700], mono);
  if (disp.size) faces += await fontFaces("Rajdhani", "RJD", [700], disp);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${faces}
text{font-family:${MONO};fill:${K.text}}
.d{font-family:${DISP};font-weight:700}
.b{font-weight:700}
@keyframes bk{50%{opacity:0}}
@keyframes pl{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes gl{0%,90%,100%{transform:translate(0,0)}91%{transform:translate(-3px,1px)}93%{transform:translate(3px,-1px)}95%{transform:translate(-1px,0)}}
@keyframes dr{from{stroke-dashoffset:1400}to{stroke-dashoffset:0}}
.bk{animation:bk 1.1s steps(1) infinite}
.pl{animation:pl 2.4s ease-in-out infinite}
${extraCss}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>
<filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="12"/></filter>
<pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1" fill="${K.accent}" fill-opacity=".16"/></pattern>
</defs>
${body}
</svg>
`;
}

const T = (x, y, s, a = "") => `<text x="${x}" y="${y}" ${a}>${esc(s)}</text>`;
const label = (x, y, head, a = "") =>
  `<text x="${x}" y="${y}" font-size="11" letter-spacing="2" fill="${K.muted}" ${a}><tspan fill="${K.accent}">■</tspan> ${esc(head)}</text>`;
const brackets = (w, h, both = true) =>
  `<path d="M1 13V1H13" fill="none" stroke="${K.accent}" stroke-width="2"/>` +
  (both ? `<path d="M${w - 13} ${h - 1}H${w - 1}V${h - 13}" fill="none" stroke="${K.accent}" stroke-width="2"/>` : "");
const panel = (w, h, rx = 6) => `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="${K.panel}" stroke="${K.border}"/>`;

// ---------------------------------------------------------------- data
const { user } = await gql(
  `query($u:String!){ user(login:$u){ createdAt repositories(ownerAffiliations:OWNER){ totalCount } } }`,
  { u: CFG.user },
);
if (!user) throw new Error(`user ${CFG.user} not found`);

const now = new Date();
const days = new Map();
for (let y = new Date(user.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
  const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
  const data = await gql(
    `query($u:String!,$f:DateTime!,$t:DateTime!){ user(login:$u){ contributionsCollection(from:$f,to:$t){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`,
    { u: CFG.user, f: `${y}-01-01T00:00:00Z`, t: to },
  );
  for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
    for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
}
const dates = [...days.keys()].sort();
const total = dates.reduce((s, d) => s + days.get(d), 0);
if (dates.length < 60 || total === 0) throw new Error(`calendar looks wrong (${dates.length} days, ${total} total); refusing to write`);
const firstDay = dates.find((d) => days.get(d) > 0);

let longest = 0, run = 0;
for (const d of dates) { run = days.get(d) > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let i = dates.length - 1;
if (days.get(dates[i]) === 0) i--;
let current = 0;
for (; i >= 0 && days.get(dates[i]) > 0; i--) current++;

// Stats the workflow's github-readme-stats step already computed (it uses the
// PAT when available, so private commits count, and it owns the rank formula).
async function parseStats() {
  const s = await readFile(join(ROOT, "cards/stats.svg"), "utf8");
  const desc = unesc((s.match(/<desc[^>]*>([^<]*)<\/desc>/) || [])[1] || "");
  const titleTxt = unesc((s.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || "");
  const pick = (re) => { const m = desc.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const out = {
    stars: pick(/Stars Earned:\s*([\d,]+)/), commits: pick(/Commits\s*:\s*([\d,]+)/),
    prs: pick(/PRs:\s*([\d,]+)/), issues: pick(/Issues:\s*([\d,]+)/),
    rank: (titleTxt.match(/Rank:\s*([A-Z][+-]*)/) || [])[1],
  };
  if (Object.values(out).some((v) => v == null)) throw new Error(`stats.svg missing a field: ${JSON.stringify(out)}`);
  return out;
}
async function parseLangs() {
  const s = await readFile(join(ROOT, "cards/top-langs.svg"), "utf8");
  const langs = [...s.replace(/\s+/g, " ").matchAll(/>\s*([A-Za-z#+.\- ]+?)\s+(\d+(?:\.\d+)?)%\s*</g)].map((m) => ({ name: m[1].trim(), pct: Number(m[2]) }));
  if (langs.length < 3) throw new Error("top-langs.svg has no languages");
  return langs.slice(0, 6);
}
async function countAchievement(a) {
  if (a.count === "kaggle") {
    const s = await readFile(join(ROOT, "cards/kaggle-badges.svg"), "utf8");
    return (s.match(/<title>/g) || []).length;
  }
  const s = await readFile(join(ROOT, a.page), "utf8");
  return (s.match(/<img[^>]+src="\.\.\/assets\//g) || []).length;
}

// ---------------------------------------------------------------- cards
const files = {};

async function hero() {
  const st = await parseStats();
  const rev = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const since = `${MON[Number(firstDay.slice(5, 7)) - 1]} ${firstDay.slice(0, 4)}`;
  const W = 800, H = 400;
  const chips = [
    { x: 40, y: 114, ref: "U1 · CONTRIBUTIONS", v: num(total), l: `SINCE ${since}`, c: K.accent, right: false },
    { x: 610, y: 114, ref: "U2 · RANK", v: st.rank, l: "GITHUB STATS GRADE", c: K.accent, right: true },
    { x: 40, y: 234, ref: "U3 · COMMITS", v: short(st.commits), l: `${num(st.prs)} PRS · ${num(st.issues)} ISSUES`, c: K.cyan, right: false },
    { x: 610, y: 234, ref: "U4 · STARS", v: num(st.stars), l: `ACROSS ${num(user.repositories.totalCount)} REPOS`, c: K.cyan, right: true },
  ];
  const pins = [];
  for (let x = 290; x <= 500; x += 14) pins.push(`<rect x="${x}" y="96" width="6" height="12"/><rect x="${x}" y="324" width="6" height="12"/>`);
  for (let y = 136; y <= 290; y += 14) pins.push(`<rect x="250" y="${y}" width="12" height="6"/><rect x="538" y="${y}" width="12" height="6"/>`);
  const [n1, n2] = CFG.name;
  const nameLayer = (dx, dy, fill, op, cls) =>
    `<g class="${cls}" opacity="${op}"><text x="${400 + dx}" y="${190 + dy}" class="d" font-size="38" text-anchor="middle" fill="${fill}">${esc(n1)}</text><text x="${400 + dx}" y="${226 + dy}" class="d" font-size="38" text-anchor="middle" fill="${fill}">${esc(n2)}</text></g>`;
  const body = `
<clipPath id="bc"><rect width="${W}" height="${H}" rx="10"/></clipPath>
<g clip-path="url(#bc)">
<rect width="${W}" height="${H}" fill="${K.panel}"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
<rect width="${W}" height="32" fill="${K.deep}"/><line x1="0" y1="32.5" x2="${W}" y2="32.5" stroke="${K.border}"/>
${T(18, 21, `${CFG.user.toUpperCase()}://PROFILE.SYS · REV ${rev}`, `font-size="11" letter-spacing="1" fill="${K.muted}"`)}
<text x="400" y="21" font-size="11" letter-spacing="1" text-anchor="middle" fill="${K.accent}"><tspan class="pl">●</tspan> LINK ESTABLISHED</text>
${T(782, 21, CFG.location, `font-size="11" letter-spacing="1" text-anchor="end" fill="${K.muted}"`)}
<g fill="none" stroke="${K.hole}" stroke-width="2"><circle cx="22" cy="52" r="6"/><circle cx="778" cy="52" r="6"/><circle cx="22" cy="378" r="6"/><circle cx="778" cy="378" r="6"/></g>
<g filter="url(#g)">
  <rect x="398" y="58" width="4" height="38" fill="${K.accent}"/>
  <rect x="190" y="154" width="60" height="4" fill="${K.accent}"/><rect x="550" y="154" width="60" height="4" fill="${K.accent}"/>
  <rect x="190" y="274" width="60" height="4" fill="${K.cyan}"/><rect x="550" y="274" width="60" height="4" fill="${K.cyan}"/>
  <rect x="398" y="336" width="4" height="34" fill="${K.accent}"/><rect x="258" y="368" width="284" height="4" fill="${K.accent}"/>
  <rect x="258" y="370" width="4" height="30" fill="${K.accent}"/><rect x="398" y="370" width="4" height="30" fill="${K.accent}"/><rect x="538" y="370" width="4" height="30" fill="${K.accent}"/>
</g>
<circle cx="400" cy="52" r="5" fill="${K.panel}" stroke="${K.accent}" stroke-width="2"/>
<g fill="#1a1326" stroke="${K.gold}"><rect x="211.5" y="150.5" width="18" height="11"/><rect x="571.5" y="150.5" width="18" height="11"/><rect x="211.5" y="270.5" width="18" height="11"/><rect x="571.5" y="270.5" width="18" height="11"/></g>
<g fill="${K.gold}"><rect x="254" y="392" width="12" height="8"/><rect x="394" y="392" width="12" height="8"/><rect x="534" y="392" width="12" height="8"/></g>
<g fill="${K.gold}">${pins.join("")}</g>
<rect x="262" y="108" width="276" height="216" rx="6" fill="${K.accent}" opacity=".28" filter="url(#soft)"/>
<rect x="262.5" y="108.5" width="275" height="215" rx="6" fill="${K.chip}" stroke="${K.chipBorder}"/>
${T(400, 146, "U0 · OPERATOR", `font-size="10" letter-spacing="3" text-anchor="middle" fill="${K.accent}"`)}
${nameLayer(-2, 0, K.cyan, 0.5, "g1")}
${nameLayer(2, 1, K.accent, 0.75, "g2")}
${nameLayer(0, 0, K.white, 1, "")}
${T(400, 258, CFG.subtitle, `font-size="10" text-anchor="middle"`)}
<text x="400" y="286" font-size="11" text-anchor="middle" fill="${K.white}"><tspan fill="${K.accent}">&gt;</tspan> shipping <tspan class="bk" fill="${K.accent}">▮</tspan></text>
${chips.map((c) => {
  const tx = c.right ? c.x + 136 : c.x + 14, anchor = c.right ? `text-anchor="end"` : "";
  return `<rect x="${c.x + 0.5}" y="${c.y + 0.5}" width="149" height="83" rx="4" fill="${K.chip}" stroke="${c.c}"/>
${T(tx, c.y + 22, c.ref, `font-size="9" letter-spacing="2" fill="${K.muted}" ${anchor}`)}
${T(tx, c.y + 54, c.v, `class="d" font-size="30" fill="${K.white}" ${anchor}`)}
${T(tx, c.y + 72, c.l, `font-size="9" letter-spacing="1" fill="${c.c}" ${anchor}`)}`;
}).join("\n")}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${K.border}"/>`;
  const css = `.g1{animation:gl 5s steps(1) infinite}.g2{animation:gl 5s steps(1) infinite;animation-delay:.12s}`;
  files["hero.svg"] = await card(W, H, `${CFG.name.join(" ")}: ${num(total)} contributions, rank ${st.rank}, ${num(st.commits)} commits, ${num(st.stars)} stars`, body, css);
}

async function jacks() {
  for (const j of CFG.links) {
    const body = `<rect x="68" y="0" width="4" height="19" fill="${K.accent}" filter="url(#g)"/>
<rect x="10.5" y="18.5" width="119" height="43" rx="4" fill="${K.chip}" stroke="${K.gold}"/>
${T(70, 35, j.ref, `font-size="9" letter-spacing="2" text-anchor="middle" fill="${K.muted}"`)}
${T(70, 52, j.label, `font-size="11" text-anchor="middle" fill="${K.white}"`)}`;
    files[`jack-${j.id}.svg`] = await card(140, 64, j.label, body);
  }
}

async function signal() {
  // GitHub-style 53 columns: Sunday-start weeks ending with the current week.
  const last = new Date(dates[dates.length - 1] + "T00:00:00Z");
  const start = new Date(last);
  start.setUTCDate(start.getUTCDate() - last.getUTCDay() - 52 * 7);
  const ramp = ["#1a1326", "#3b1a63", "#5d2a9e", "#8a3ad6", "#b45cff", "#e7b8ff"];
  const lvl = (v) => (v === 0 ? 0 : v < 4 ? 1 : v < 13 ? 2 : v < 41 ? 3 : v < 101 ? 4 : 5);
  const lo = [], hi = [], months = [];
  let events = 0, peak = 0, lastMonthCol = -9;
  for (let c = 0; c < 53; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + c * 7 + r);
      const iso = d.toISOString().slice(0, 10);
      if (!days.has(iso)) continue;
      const v = days.get(iso);
      events += v; peak = Math.max(peak, v);
      if (r === 0 && d.getUTCDate() <= 7 && c - lastMonthCol >= 3) { months.push([c, MON[d.getUTCMonth()]]); lastMonthCol = c; }
      const L = lvl(v), dot = `<circle cx="${57 + c * 13 + 5}" cy="${56 + r * 13 + 5}" r="5" fill="${ramp[L]}"/>`;
      (L >= 3 ? hi : lo).push(dot);
    }
  }
  const W = 800, H = 192;
  const body = `${panel(W, H)}${brackets(W, H)}
${label(20, 30, "SIGNAL MAP // LED ARRAY 53×7")}
${T(780, 30, `${num(events)} EVENTS · PEAK ${peak}/DAY`, `font-size="11" letter-spacing="2" text-anchor="end" fill="${K.muted}"`)}
<rect x="20" y="44" width="760" height="112" rx="6" fill="#050309"/>
${lo.join("")}
<g filter="url(#g)">${hi.join("")}</g>
${months.map(([c, m]) => T(57 + c * 13, 176, m, `font-size="10" fill="${K.muted}"`)).join("")}`;
  files["signal.svg"] = await card(W, H, `${num(events)} contributions in the last year`, body);
}

async function scope() {
  const langs = await parseLangs();
  const gd = days.get(dates[dates.length - 1]) === 0 ? dates.slice(0, -1) : dates;
  const last = gd.slice(-31), vals = last.map((d) => days.get(d));
  const mx = Math.max(4, ...vals), sum = vals.reduce((a, b) => a + b, 0);
  const pts = vals.map((v, k) => `${(18 + (k * 417) / 30).toFixed(1)},${(44 + 176 - (v / mx) * 150).toFixed(1)}`).join(" ");
  const grid = [];
  for (let x = 16 + 37; x < 437; x += 37) grid.push(`<line x1="${x}" y1="42" x2="${x}" y2="242"/>`);
  for (let y = 42 + 40; y < 242; y += 40) grid.push(`<line x1="16" y1="${y}" x2="437" y2="${y}"/>`);
  const top = Math.max(...langs.map((l) => l.pct));
  const eq = langs.map((l, k) => {
    const x = 485 + k * 53.8, on = Math.max(1, Math.round((l.pct / top) * 14));
    const segs = [];
    for (let s = 0; s < 14; s++) {
      const c = s >= on ? "#1d1430" : s >= 11 ? K.pink : s >= 7 ? K.cyan : K.accent;
      segs.push(`<rect x="${x.toFixed(1)}" y="${241 - s * 12}" width="30" height="9" rx="1" fill="${c}"${s < on ? ` filter="url(#g)"` : ""}/>`);
    }
    const short = l.name === "JavaScript" ? "JS" : l.name === "TypeScript" ? "TS" : l.name === "Python" ? "PY" : l.name.toUpperCase().slice(0, 5);
    return segs.join("") + T((x + 15).toFixed(1), 70, `${Math.round(l.pct)}%`, `font-size="10" text-anchor="middle" fill="${K.white}"`) +
      T((x + 15).toFixed(1), 268, short, `font-size="10" text-anchor="middle" fill="${K.muted}"`);
  });
  const W = 800, H = 284;
  const body = `<g>${panel(453, H)}${brackets(453, H, false)}</g>
${label(16, 28, "OSC-1 // THROUGHPUT 31D")}
${T(437, 28, `CH1 Σ ${num(sum)} · PEAK ${Math.max(...vals)}`, `font-size="11" letter-spacing="1" text-anchor="end" fill="${K.muted}"`)}
<rect x="17" y="43" width="419" height="198" rx="8" fill="#06110f" stroke="#1f2b28" stroke-width="2"/>
<g stroke="${K.cyan}" stroke-opacity=".12">${grid.join("")}</g>
<polyline points="${pts}" fill="none" stroke="${K.cyan}" stroke-width="5" stroke-opacity=".25" stroke-linejoin="round"/>
<polyline points="${pts}" fill="none" stroke="#bff8ff" stroke-width="1.8" stroke-linejoin="round"/>
${T(16, 264, `T0 ${dlabel(last[0])}`, `font-size="10" fill="${K.muted}"`)}
${T(226, 264, `STREAK ${current} · MAX ${longest}`, `font-size="10" text-anchor="middle" fill="${K.muted}"`)}
${T(437, 264, `T31 ${dlabel(last[last.length - 1])}`, `font-size="10" text-anchor="end" fill="${K.muted}"`)}
<g transform="translate(469 0)">${panel(331, H)}<path d="M${331 - 13} ${H - 1}H${331 - 1}V${H - 13}" fill="none" stroke="${K.accent}" stroke-width="2"/></g>
${label(485, 28, "EQ // LANGUAGE MIX")}
${eq.join("")}`;
  files["scope.svg"] = await card(W, H, `${sum} contributions in the last 31 days; languages: ${langs.map((l) => `${l.name} ${l.pct}%`).join(", ")}`, body,
  );
}

async function processes() {
  const q = CFG.featured.map((f, k) => `r${k}: repository(owner:$u, name:"${f.repo}"){ stargazerCount url primaryLanguage{ name color } }`).join("\n");
  const data = await gql(`query($u:String!){ ${q} }`, { u: CFG.user });
  const rows = CFG.featured.map((f, k) => ({ ...f, r: data[`r${k}`] })).filter((x) => x.r);
  if (!rows.length) throw new Error("no featured repos resolved");
  const maxS = Math.max(...rows.map((x) => x.r.stargazerCount), 1);
  const W = 800;
  const head = `${panel(W, 74)}
${label(20, 26, "ACTIVE PROCESSES // FEATURED")}
${T(780, 26, `${rows.length} RUNNING`, `font-size="11" letter-spacing="2" text-anchor="end" fill="${K.muted}"`)}
<rect x="1" y="40" width="${W - 2}" height="30" fill="${K.accent}"/>
<g font-size="10" letter-spacing="2" class="b">
${T(20, 59, "#", `class="b" font-size="10" fill="${K.panel}"`)}${T(60, 59, "PROCESS", `class="b" font-size="10" letter-spacing="2" fill="${K.panel}"`)}
${T(470, 59, "LANG", `class="b" font-size="10" letter-spacing="2" fill="${K.panel}"`)}${T(590, 59, "STARS", `class="b" font-size="10" letter-spacing="2" fill="${K.panel}"`)}
${T(650, 59, "LOAD", `class="b" font-size="10" letter-spacing="2" fill="${K.panel}"`)}
</g>`;
  files["proc-head.svg"] = await card(W, 74, "Featured projects", head);
  for (const [k, x] of rows.entries()) {
    const lang = x.r.primaryLanguage?.name || "—";
    const color = LANG_COLOR[lang] || x.r.primaryLanguage?.color || K.muted;
    const on = Math.max(1, Math.round((Math.max(x.r.stargazerCount, 6) / maxS) * 14));
    const segs = Array.from({ length: 14 }, (_, s) => `<rect x="${650 + s * 9}" y="21" width="7" height="12" rx="1" fill="${s < on ? K.accent : "#1d1430"}"/>`).join("");
    const body = `<rect x=".5" y=".5" width="${W - 1}" height="53" rx="4" fill="${K.panel}" stroke="${K.border}"/>
${T(20, 32, String(k + 1).padStart(2, "0"), `font-size="12" fill="${K.muted}"`)}
${T(60, 24, clip(x.repo, 48), `class="b" font-size="13" fill="${K.white}"`)}
${T(60, 42, clip(x.desc, 58), `font-size="11" fill="${K.muted}"`)}
<circle cx="474" cy="28" r="4" fill="${color}"/>
${T(484, 32, lang, `font-size="12"`)}
${T(590, 32, num(x.r.stargazerCount), `font-size="12" fill="${K.white}"`)}
<g filter="url(#g)">${segs}</g>`;
    files[`proc-${x.repo}.svg`] = await card(W, 54, `${x.repo}: ${x.desc} (${lang}, ${x.r.stargazerCount} stars)`, body);
  }
}

async function arsenal() {
  const W = 800, cw = 7.2, pad = 24, gap = 9, ph = 26, pitch = 35, maxW = 760;
  const rows = [[]];
  let wsum = 0;
  for (const name of CFG.stack) {
    const w = name.length * cw + pad;
    if (wsum + w + (rows.at(-1).length ? gap : 0) > maxW) { rows.push([]); wsum = 0; }
    wsum += w + (rows.at(-1).length ? gap : 0);
    rows.at(-1).push({ name, w });
  }
  const colors = [K.accent, K.cyan, K.pink];
  let idx = 0;
  const pills = rows.map((row, r) => {
    const rw = row.reduce((s, p) => s + p.w, 0) + gap * (row.length - 1);
    let x = 20 + (maxW - rw) / 2;
    const y = 48 + r * pitch;
    return row.map((p) => {
      const c = colors[idx++ % 3];
      const out = `<rect x="${x.toFixed(1)}" y="${y}" width="${p.w.toFixed(1)}" height="${ph}" rx="13" fill="none" stroke="${c}" filter="url(#g)"/>` +
        T((x + p.w / 2).toFixed(1), y + 17, p.name, `font-size="12" text-anchor="middle" fill="${K.lilac}"`);
      x += p.w + gap;
      return out;
    }).join("");
  }).join("\n");
  const H = 48 + rows.length * pitch + 12;
  const body = `${panel(W, H)}${brackets(W, H)}
${label(20, 30, "ARSENAL // STACK")}
${pills}`;
  files["arsenal.svg"] = await card(W, H, `Stack: ${CFG.stack.join(", ")}`, body);
}

async function qc() {
  const W = 800;
  files["qc-head.svg"] = await card(W, 44, "Achievements", `${panel(W, 44)}
${label(20, 27, "QC // ACHIEVEMENTS")}
${T(780, 27, "PRESS A TEST POINT TO OPEN ITS FULL SET", `font-size="11" letter-spacing="2" text-anchor="end" fill="${K.muted}"`)}`);
  for (const a of CFG.achievements) {
    let n;
    try { n = await countAchievement(a); } catch (e) { console.error(`count ${a.id}: ${e.message}`); continue; }
    if (!n) { console.error(`count ${a.id} is 0; keeping last card`); continue; }
    const c = a.color;
    const dots = Array.from({ length: n }, (_, k) => {
      const t = -Math.PI / 2 + (k * 2 * Math.PI) / n;
      return `<circle cx="${(95 + 63 * Math.cos(t)).toFixed(1)}" cy="${(84 + 63 * Math.sin(t)).toFixed(1)}" r="2" fill="${c}"/>`;
    }).join("");
    const body = `<rect x=".5" y=".5" width="189" height="309" rx="8" fill="#100a1a" stroke="${K.border}"/>
<g filter="url(#g)">${dots}</g>
<circle cx="95" cy="84" r="50" fill="${c}" opacity=".22" filter="url(#soft)"/>
<circle cx="95" cy="84" r="49" fill="${K.panel}" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>
${T(95, 94, String(n), `class="d" font-size="34" text-anchor="middle" fill="${K.white}"`)}
${T(95, 110, "PASSED", `font-size="9" letter-spacing="2" text-anchor="middle" fill="${c}"`)}
${T(95, 123, a.tp, `font-size="8" letter-spacing="1" text-anchor="middle" fill="${K.muted}"`)}
${T(95, 176, a.label, `class="b" font-size="13" text-anchor="middle" fill="${K.white}"`)}
<line x1="14" y1="190.5" x2="176" y2="190.5" stroke="${K.border}"/>
${a.top.slice(0, 3).map((s, k) => `<text x="14" y="${212 + k * 18}" font-size="10"><tspan fill="${c}">▸</tspan> ${esc(clip(s, 24))}</text>`).join("")}
<rect x="14.5" y="266.5" width="161" height="27" rx="3" fill="${c}" fill-opacity=".12" stroke="${c}"/>
${T(95, 284, `OPEN ALL ${n} ↗`, `font-size="10" letter-spacing="1.5" text-anchor="middle" fill="${c}"`)}`;
    files[`qc-${a.id}.svg`] = await card(190, 310, `${a.label}: ${n}. Open the full set.`, body);
  }
  files["qc-foot.svg"] = await card(W, 40, CFG.community.text, `${panel(W, 40)}
<text x="400" y="25" font-size="11" letter-spacing="1.5" text-anchor="middle" fill="${K.muted}">EACH DOT = ONE ACHIEVEMENT · <tspan fill="${K.accent}">${esc(CFG.community.text)} ↗</tspan></text>`);
}

async function footer() {
  const ist = new Date(now.getTime() + 5.5 * 3600e3);
  const stamp = `${ist.getUTCDate()} ${MON[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
  files["footer.svg"] = await card(800, 44, `Last sync ${stamp}`, `${panel(800, 44)}
${T(20, 27, `FIRMWARE REFRESH: EVERY 6 H · LAST SYNC ${stamp}`, `font-size="11" letter-spacing="1" fill="${K.muted}"`)}
<text x="780" y="27" font-size="11" letter-spacing="1" text-anchor="end" fill="${K.accent}">EOF<tspan class="bk">_</tspan></text>`);
}

let failed = 0;
for (const [name, fn] of Object.entries({ hero, jacks, signal, scope, processes, arsenal, qc, footer })) {
  try { await fn(); } catch (e) { failed++; console.error(`::warning::board card "${name}" skipped, keeping last good copy: ${e.message}`); }
}
await mkdir(OUT, { recursive: true });
for (const [f, svg] of Object.entries(files)) await writeFile(join(OUT, f), svg);
console.log(`ok: wrote ${Object.keys(files).length} cards (${failed} sections skipped); total=${total} streak=${current} longest=${longest}`);
