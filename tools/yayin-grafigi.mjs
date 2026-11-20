// tools/yayin-verisi.mjs çıktısından (docs/metrics/GÜN.json) iki panelli bir çizgi grafik üretir: eş zamanlı izleyici ve
// dakikadaki yorum. İki ölçü ayrı panellerde durur (tek eksende iki ölçek yok); oturumlar arasındaki boşluklar çizilmez.
// Kullanım: node tools/yayin-grafigi.mjs YYYY-AA-GG   → docs/metrics/GÜN.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'metrics');
const day = process.argv[2], source = path.join(dir, day + '.json');
if (!day || !fs.existsSync(source)) { console.log('Kullanım: node tools/yayin-grafigi.mjs YYYY-AA-GG   (önce tools/yayin-verisi.mjs çalıştır)'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
const minuteOf = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const sessions = data.sessions.map((s) => s.rows.map(([time, viewers, , chats]) => ({ time, x: minuteOf(time), viewers, chats })));
const all = sessions.flat();

const W = 880, H = 430, LEFT = 52, RIGHT = 28, PLOT = W - LEFT - RIGHT;
const x0 = Math.floor(Math.min(...all.map((p) => p.x)) / 60) * 60, x1 = Math.ceil(Math.max(...all.map((p) => p.x)) / 60) * 60;
const sx = (minute) => LEFT + ((minute - x0) / (x1 - x0)) * PLOT;
const nice = (max) => { const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => max / s <= 4) || 2000; return { step, top: Math.ceil(max / step) * step }; };
const r1 = (n) => Math.round(n * 10) / 10;
const date = new Date(data.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function panel({ key, title, top, height }) {
  const { step, top: max } = nice(Math.max(...all.map((p) => p[key])));
  const sy = (v) => top + height - (v / max) * height, base = top + height;
  let out = `<text class="panel" x="${LEFT}" y="${top - 12}">${title}</text>`;
  for (let v = 0; v <= max; v += step) out += `<line class="grid" x1="${LEFT}" x2="${W - RIGHT}" y1="${r1(sy(v))}" y2="${r1(sy(v))}"/><text class="tick" x="${LEFT - 8}" y="${r1(sy(v) + 4)}" text-anchor="end">${v}</text>`;
  for (const rows of sessions) {
    const pts = rows.map((p) => `${r1(sx(p.x))},${r1(sy(p[key]))}`);
    out += `<path class="wash" d="M${r1(sx(rows[0].x))},${base} L${pts.join(' L')} L${r1(sx(rows.at(-1).x))},${base} Z"/><path class="line" d="M${pts.join(' L')}"/>`;
  }
  // Tek etiket: en yüksek nokta. Diğer değerleri eksen ve aşağıdaki tablo taşır.
  const peak = all.reduce((a, b) => (b[key] > a[key] ? b : a)), px = sx(peak.x), py = sy(peak[key]), right = px < W - RIGHT - 150;
  out += `<circle class="ring" cx="${r1(px)}" cy="${r1(py)}" r="6"/><circle class="dot" cx="${r1(px)}" cy="${r1(py)}" r="4"/>`;
  out += `<text class="label" x="${r1(px + (right ? 12 : -12))}" y="${r1(py + 4)}" text-anchor="${right ? 'start' : 'end'}"><tspan class="value">${peak[key]}</tspan> at ${peak.time}</text>`;
  return out;
}
let axis = '';
for (let m = x0; m <= x1; m += 60) axis += `<text class="tick" x="${r1(sx(m))}" y="${H - 22}" text-anchor="middle">${String(m / 60).padStart(2, '0')}:00</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Live sessions on ${date}: concurrent viewers and chat messages per minute</title>
<desc id="d">${data.sessions.length} sessions. Peak ${Math.max(...all.map((p) => p.viewers))} concurrent viewers; ${data.sessions.reduce((n, s) => n + s.chatMessages, 0)} chat messages in total. The same numbers are in the table next to this chart.</desc>
<style>
  svg { --surface: #fcfcfb; --text: #0b0b0b; --text-2: #52514e; --muted: #898781; --grid: #e1e0d9; --series: #2a78d6; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  @media (prefers-color-scheme: dark) { svg { --surface: #1a1a19; --text: #f0efec; --text-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --series: #3987e5; } }
  .bg { fill: var(--surface); } .title { fill: var(--text); font-size: 16px; font-weight: 600; } .sub { fill: var(--text-2); font-size: 12px; }
  .panel { fill: var(--text-2); font-size: 12px; font-weight: 600; } .tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .grid { stroke: var(--grid); stroke-width: 1; } .line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .wash { fill: var(--series); fill-opacity: .1; } .dot { fill: var(--series); } .ring { fill: var(--surface); }
  .label { fill: var(--text-2); font-size: 12px; } .value { fill: var(--text); font-weight: 600; }
</style>
<rect class="bg" width="${W}" height="${H}" rx="10"/>
<text class="title" x="${LEFT}" y="32">One day of live sessions · ${date}</text>
<text class="sub" x="${LEFT}" y="50">Per-minute aggregates from the show's own journal. Gaps are time off air.</text>
${panel({ key: 'viewers', title: 'Concurrent viewers', top: 96, height: 120 })}
${panel({ key: 'chats', title: 'Chat messages per minute', top: 270, height: 110 })}
${axis}
</svg>
`;
const target = path.join(dir, day + '.svg');
fs.writeFileSync(target, svg);
console.log('Grafik yazıldı: ' + target);
