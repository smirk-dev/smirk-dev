#!/usr/bin/env node
// Renders cards/streak.svg and cards/activity.svg from the GitHub contribution
// calendar. Runs in GitHub Actions with the built-in GITHUB_TOKEN, so there is
// no third-party service and no personal token that can expire.
//
// Safety: if anything fails (API error, empty data), it exits non-zero BEFORE
// writing, so the last good SVG committed in the repo keeps rendering.
//
// Usage: GITHUB_TOKEN=... node scripts/contrib-cards.mjs <username> <outDir>

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER = process.argv[2] || "smirk-dev";
const OUT = process.argv[3] || "cards";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

const C = {
  bg: "#0D1117",
  accent: "#B347FF",
  text: "#c9d1d9",
  strong: "#FFFFFF",
  grid: "#30363d",
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";

async function gql(query, variables) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.errors) return body.data;
    console.error(`GraphQL attempt ${attempt} failed: ${res.status} ${JSON.stringify(body.errors || body).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error("GraphQL failed after 3 attempts");
}

// ---------- data ----------
const { user } = await gql(`query($u:String!){ user(login:$u){ createdAt } }`, { u: USER });
if (!user) throw new Error(`user ${USER} not found`);

const now = new Date();
const days = new Map(); // "YYYY-MM-DD" -> count
for (let y = new Date(user.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
  const from = `${y}-01-01T00:00:00Z`;
  const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
  const data = await gql(
    `query($u:String!,$f:DateTime!,$t:DateTime!){ user(login:$u){ contributionsCollection(from:$f,to:$t){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`,
    { u: USER, f: from, t: to },
  );
  for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
    for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
}

const dates = [...days.keys()].sort();
if (dates.length < 30) throw new Error(`only ${dates.length} calendar days returned; refusing to write`);

const total = dates.reduce((s, d) => s + days.get(d), 0);
const firstDay = dates.find((d) => days.get(d) > 0) || dates[0];

// Longest streak
let longest = { len: 0, start: null, end: null };
let run = { len: 0, start: null };
for (const d of dates) {
  if (days.get(d) > 0) {
    if (run.len === 0) run.start = d;
    run.len++;
    if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d };
  } else run.len = 0;
}

// Current streak: today with zero contributions does not break it yet.
let i = dates.length - 1;
if (days.get(dates[i]) === 0) i--;
let current = { len: 0, start: null, end: dates[i] };
for (; i >= 0 && days.get(dates[i]) > 0; i--) {
  current.len++;
  current.start = dates[i];
}

if (total === 0) throw new Error("zero total contributions; refusing to write (likely an API/token problem)");

// ---------- helpers ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const thisYear = now.getUTCFullYear();
const fmt = (iso, forceYear = false) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${forceYear || y !== thisYear ? `, ${y}` : ""}`;
};
const range = (a, b) => (!a ? "" : a === b ? fmt(a) : `${fmt(a)} - ${fmt(b)}`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (x) => x.toLocaleString("en-US");

// ---------- streak card (495x195) ----------
const streakSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="GitHub contribution streak">
<title>${esc(USER)}: ${n(total)} contributions, current streak ${current.len}, longest ${longest.len}</title>
<style>
  text{font-family:${FONT}}
  .num{font-size:28px;font-weight:700}
  .lbl{font-size:14px;font-weight:400}
  .dt{font-size:12px;font-weight:400}
  @keyframes f{from{opacity:0}to{opacity:1}}
  .a{animation:f .6s ease-in-out forwards;opacity:0}
</style>
<rect width="495" height="195" rx="4.5" fill="${C.bg}"/>
<g text-anchor="middle">
  <g class="a" style="animation-delay:.2s">
    <text x="82.5" y="79" class="num" fill="${C.accent}">${n(total)}</text>
    <text x="82.5" y="114" class="lbl" fill="${C.text}">Total Contributions</text>
    <text x="82.5" y="139" class="dt" fill="${C.text}">${esc(fmt(firstDay, true))} - Present</text>
  </g>
  <g>
    <mask id="ringGap"><rect width="495" height="195" fill="#fff"/><ellipse cx="247.5" cy="32" rx="13" ry="18" fill="#000"/></mask>
    <circle cx="247.5" cy="71" r="40" fill="none" stroke="${C.accent}" stroke-width="5" mask="url(#ringGap)"/>
    <path transform="translate(236.5 20)" fill="${C.accent}" d="M11 0C11 0 3 7.5 3 14.2C3 18.6 6.6 22 11 22C15.4 22 19 18.6 19 14.2C19 10.5 16.6 7.3 15.3 6C15.3 9 13.6 10.8 12 11.2C13 7.6 12.4 3.3 11 0Z"/>
    <text x="247.5" y="83" class="num a" fill="${C.strong}" style="animation-delay:.4s">${current.len}</text>
    <text x="247.5" y="139" class="lbl a" fill="${C.accent}" font-weight="700" style="animation-delay:.5s">Current Streak</text>
    <text x="247.5" y="160" class="dt a" fill="${C.text}" style="animation-delay:.6s">${esc(range(current.start, current.end))}</text>
  </g>
  <g class="a" style="animation-delay:.7s">
    <text x="412.5" y="79" class="num" fill="${C.accent}">${n(longest.len)}</text>
    <text x="412.5" y="114" class="lbl" fill="${C.text}">Longest Streak</text>
    <text x="412.5" y="139" class="dt" fill="${C.text}">${esc(range(longest.start, longest.end))}</text>
  </g>
</g>
</svg>
`;

// ---------- activity graph (last 31 days) ----------
// Today is still in progress: leave it out while it is zero, so the graph
// doesn't dip to 0 every morning.
const graphDates = days.get(dates[dates.length - 1]) === 0 ? dates.slice(0, -1) : dates;
const last = graphDates.slice(-31);
const vals = last.map((d) => days.get(d));
const W = 1000, H = 360, L = 70, R = 30, T = 70, B = 60;
const pw = W - L - R, ph = H - T - B;
const maxV = Math.max(4, ...vals);
const niceStep = (raw) => {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
};
const step = niceStep(maxV / 4);
const top = step * 4;
const x = (k) => L + (pw * k) / (last.length - 1);
const y = (v) => T + ph - (ph * v) / top;
const pts = vals.map((v, k) => [x(k), y(v)]);
const line = pts.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
const area = `${line} L${x(last.length - 1).toFixed(1)} ${T + ph} L${L} ${T + ph} Z`;
const grid = [0, 1, 2, 3, 4]
  .map((k) => {
    const v = step * k, gy = y(v).toFixed(1);
    return `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="${C.grid}" stroke-width="1"/><text x="${L - 12}" y="${gy}" dy="4" text-anchor="end" class="ax">${v}</text>`;
  })
  .join("");
const xl = last
  .map((d, k) => `<text x="${x(k).toFixed(1)}" y="${T + ph + 22}" text-anchor="middle" class="ax">${Number(d.slice(8))}</text>`)
  .join("");
const dots = pts
  .map(([px, py], k) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${C.strong}"><title>${last[k]}: ${vals[k]}</title></circle>`)
  .join("");
const sum31 = vals.reduce((a, b) => a + b, 0);

const activitySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub activity, last 31 days">
<title>${esc(USER)}: ${sum31} contributions in the last 31 days</title>
<style>
  text{font-family:${FONT}}
  .t{font-size:22px;font-weight:700}
  .s{font-size:13px}
  .ax{font-size:12px;fill:${C.text}}
</style>
<rect width="${W}" height="${H}" rx="6" fill="${C.bg}"/>
<text x="${W / 2}" y="34" text-anchor="middle" class="t" fill="${C.accent}">Suryansh's GitHub Activity Graph</text>
<text x="${W / 2}" y="54" text-anchor="middle" class="s" fill="${C.text}">${sum31} contributions · ${esc(fmt(last[0]))} - ${esc(fmt(last[last.length - 1]))}</text>
${grid}
<path d="${area}" fill="#FFFFFF" fill-opacity="0.12"/>
<path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linejoin="round"/>
${dots}
${xl}
<text x="${W / 2}" y="${H - 12}" text-anchor="middle" class="ax">Days</text>
<text transform="translate(20 ${T + ph / 2}) rotate(-90)" text-anchor="middle" class="ax">Contributions</text>
</svg>
`;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "streak.svg"), streakSvg);
await writeFile(join(OUT, "activity.svg"), activitySvg);
console.log(`ok: total=${total} current=${current.len} (${current.start}..${current.end}) longest=${longest.len} (${longest.start}..${longest.end}) last31=${sum31}`);
