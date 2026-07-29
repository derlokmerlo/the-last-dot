#!/usr/bin/env node
// Refresh The Last Dot with a new rider snapshot.
//
//   node refresh.js <riders.txt> <epochSeconds>
//
// <riders.txt>  one rider per line:  name;pos;km;kmPerDay;cat;idlePct;gcFlag
//               cat = S | F | P      gcFlag = 1 in GC, 0 missed a closed control
// <epochSeconds> when the positions were read (Unix seconds).
//
// Rewrites the RAW block and DATA_MS in tcr12-cutoff.html, then regenerates
// dist/index.html. Everything else on the page derives itself from those two.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SRC = path.join(DIR, 'tcr12-cutoff.html');
const OUT = path.join(DIR, 'dist', 'index.html');

const [dataPath, epoch] = process.argv.slice(2);
if (!dataPath || !epoch) {
  console.error('usage: node refresh.js <riders.txt> <epochSeconds>');
  process.exit(1);
}

const data = fs.readFileSync(dataPath, 'utf8').trim();
const rows = data.split('\n').filter(Boolean);

// --- sanity gates: refuse to publish a snapshot that looks wrong ------------
const bad = rows.filter(r => r.split(';').length !== 7);
if (bad.length) {
  console.error(`ABORT: ${bad.length} row(s) do not have 7 fields, e.g. ${bad[0]}`);
  process.exit(1);
}
if (rows.length < 200) {
  console.error(`ABORT: only ${rows.length} riders — expected 300+. Extraction probably failed.`);
  process.exit(1);
}
const numeric = rows.every(r => {
  const p = r.split(';');
  return +p[2] > 0 && +p[3] > 0 && /^[10D]$/.test(p[6]);
});
if (!numeric) { console.error('ABORT: a rider has bad km / km-per-day, or a status that is not 1, 0 or D.'); process.exit(1); }

const ts = parseInt(epoch, 10) * 1000;
if (!Number.isFinite(ts) || ts < Date.UTC(2026, 6, 19)) {
  console.error('ABORT: timestamp is not a plausible race-time epoch in seconds.');
  process.exit(1);
}

let src = fs.readFileSync(SRC, 'utf8');
const prev = src.match(/const RAW = `([\s\S]*?)`;/);
if (!prev) { console.error('ABORT: RAW block not found in tcr12-cutoff.html'); process.exit(1); }
const prevRows = prev[1].trim().split('\n').filter(Boolean).length;

// Never let the field silently collapse — a big drop means a parsing problem,
// not 100 riders scratching in an hour.
if (rows.length < prevRows * 0.8) {
  console.error(`ABORT: rider count fell from ${prevRows} to ${rows.length} (>20%). Refusing to publish.`);
  process.exit(1);
}

const d = new Date(ts);
const dateExpr = `Date.UTC(${d.getUTCFullYear()}, ${d.getUTCMonth()}, ${d.getUTCDate()}, ${d.getUTCHours()}, ${d.getUTCMinutes()})`;

src = src.replace(/const RAW = `[\s\S]*?`;/, 'const RAW = `' + data + '`;');
src = src.replace(/const DATA_MS = [^;]+;/, `const DATA_MS = ${dateExpr};`);
fs.writeFileSync(SRC, src);

// --- rebuild the standalone document for static hosting --------------------
const title = src.match(/<title>([\s\S]*?)<\/title>/)[1];
const body = src.replace(/<title>[\s\S]*?<\/title>\s*/, '');
const favSvg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='44' fill='#fbfbf9' stroke='#0b0c0c' stroke-width='6'/><circle cx='33' cy='67' r='13' fill='#0b0c0c'/></svg>";
const fav = 'data:image/svg+xml,' + encodeURIComponent(favSvg);
const head = [
  '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>' + title + '</title>',
  '<meta name="description" content="The Last Dot follows the tail of the field in ultra-distance bike races - the riders racing the cut-off to the finish. Current edition: Transcontinental Race No12. An independent dot-watcher project, not affiliated with the organisers.">',
  '<meta name="robots" content="index, follow">',
  '<meta property="og:title" content="The Last Dot - Following the tail of the field">',
  '<meta property="og:description" content="The riders at the back, racing the cut-off to the finish. Current edition: Transcontinental Race No12.">',
  '<meta property="og:type" content="website">',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap" rel="stylesheet">',
  '<link rel="icon" href="' + fav + '">',
  '<style>*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0}img,svg{max-width:100%}button,input,textarea{font:inherit;color:inherit}</style>',
  '</head>', '<body>'
].join('\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, head + '\n' + body + '\n</body>\n</html>\n');

const outOfGc = rows.filter(r => r.endsWith(';0')).length;
console.log(`OK ${rows.length} riders (${outOfGc} out of GC) @ ${d.toISOString()} -> dist/index.html`);
