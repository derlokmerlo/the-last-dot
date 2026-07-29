#!/usr/bin/env node
// Scrape the FollowMyChallenge TCRNo12 live tracker with a real headless
// browser (the site sits behind a Cloudflare JS challenge, so plain HTTP
// requests get a 403) and write a riders snapshot for viz/refresh.js.
//
//   node scraper/scrape.js <out.txt>
//
// Prints the snapshot epoch (Unix seconds) on stdout; all logging goes to
// stderr so the caller can capture the epoch alone.
const fs = require('fs');
const { chromium } = require('playwright-core');

const URL = 'https://www.followmychallenge.com/live/tcrno12/';
const START_UNIX = 1784484000; // 19 Jul 2026, 18:00 UTC — official start
const MAX_ATTEMPTS = 3;
const log = (...a) => console.error(...a);

// Runs inside the page. Produces riders.txt rows: name;pos;km;kmPerDay;cat;idlePct;gcFlag
const EXTRACT = () => {
  const START = 1784484000, ROUTE = 4442.3; // route length implied by the tracker's dtf
  // Control closing times (organiser config, CEST → UTC). A rider whose last
  // validated control was hit after that control closed, or who has validated
  // fewer controls than have already closed, is out of the GC.
  const CP_CLOSE = [Date.UTC(2026, 6, 22, 9) / 1e3, Date.UTC(2026, 6, 30, 9) / 1e3,
                    Date.UTC(2026, 7, 2, 21, 59) / 1e3, Date.UTC(2026, 7, 5, 21, 59) / 1e3];
  const now = Date.now() / 1000, days = (now - START) / 86400;
  const closed = CP_CLOSE.filter(t => now > t).length;
  const parseEl = s => { const m = s && s.match(/(\d+)\s*d\s*(\d+)\s*h\s*(\d+)\s*m/); return m ? +m[1] + m[2] / 24 + m[3] / 1440 : null; };
  const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const riders = [];
  let maxActiveElapsed = 0;
  for (const r of Object.values(ridersArray)) {
    if (r.groupHeaderLabel === 'Crew' || !isFinite(r.dtfKM)) continue;
    const scr = r.scratched == 1;
    const idle = r.stoppedPercentage || 0;
    if (!scr) {
      const el = parseEl(r.totalTimeElapsed);
      if (el > maxActiveElapsed) maxActiveElapsed = el;
    }
    // Tracker artifacts: a dead tracker idles at 0% forever; one that never
    // left the start idles at ~100%.
    if (!scr && (idle <= 0 || idle >= 99)) continue;
    // Route progress is ROUTE − dtf, but a scratched rider's tracker keeps
    // reporting from the car ride home, dragging dtf below reality — the
    // odometer caps it.
    const km = +Math.min(ROUTE - r.dtfKM, r.totalDistance > 0 ? r.totalDistance : Infinity).toFixed(1);
    if (!isFinite(km) || km <= 5) continue;
    const elStop = scr ? parseEl(r.totalTimeElapsed) : null;
    let kmd = +((scr && elStop > 0.5) ? km / elStop : km / days).toFixed(1);
    // A frozen scratch-time clock implies an impossible pace — fall back to the
    // race-elapsed average so the rider stays on the board instead of vanishing.
    if (scr && !(kmd > 0 && kmd <= 520)) kmd = +(km / days).toFixed(1);
    if (!(kmd > 0)) continue;
    const late = r.cpCount >= 1 && r.cpCount <= CP_CLOSE.length && +r.cpLastHitUnix > CP_CLOSE[r.cpCount - 1];
    riders.push({
      name: (r.riderName || '').trim().replace(/;/g, ','), km, kmd,
      cat: r.groupHeaderLabel === 'Pair' ? 'P' : (/lbtag:FLINTA/.test(r.tags || '') ? 'F' : 'S'),
      idle: scr ? 0 : idle,
      gc: scr ? 'D' : ((r.groupHeaderLabel === 'Outside of GC' || r.cpCount < closed || late) ? '0' : '1'),
    });
  }
  const pairs = riders.filter(r => r.cat === 'P').sort((a, b) => b.km - a.km);
  const rest = riders.filter(r => r.cat !== 'P').sort((a, b) => b.km - a.km);
  pairs.forEach((r, i) => r.pos = ord(i + 1));
  rest.forEach((r, i) => r.pos = ord(i + 1));
  return {
    epoch: Math.floor(now),
    maxActiveElapsed,
    lines: [...rest, ...pairs].map(r => [r.name, r.pos, r.km, r.kmd, r.cat, r.idle, r.gc].join(';')),
  };
};

(async () => {
  const out = process.argv[2];
  if (!out) { log('usage: node scrape.js <out.txt>'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
  })).newPage();

  let snap = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !snap; attempt++) {
    log(`attempt ${attempt}: loading tracker…`);
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
      // The Cloudflare interstitial resolves itself, then the app boots and
      // fills ridersArray; wait for a substantially populated roster.
      await page.waitForFunction(
        () => typeof ridersArray !== 'undefined' && Object.values(ridersArray).length > 300,
        null,
        { timeout: 120000 },
      );
      await page.waitForTimeout(5000); // let per-rider stats hydrate
      snap = await page.evaluate(EXTRACT);
    } catch (e) {
      log(`attempt ${attempt} failed: ${e.message}`);
      log(`page title: ${await page.title().catch(() => '?')}`);
      continue;
    }
    // Freshness gate: FMC sometimes serves a stale cached dataset (seen up to
    // 20h old). The race chronometer is the authority — the most-elapsed
    // active rider must agree with the wall clock.
    const expectedDays = (Date.now() / 1000 - START_UNIX) / 86400;
    const drift = expectedDays - snap.maxActiveElapsed;
    log(`rows=${snap.lines.length} elapsed=${snap.maxActiveElapsed.toFixed(3)}d expected=${expectedDays.toFixed(3)}d drift=${(drift * 24).toFixed(1)}h`);
    if (Math.abs(drift) > 0.1 || snap.lines.length < 300) {
      log('stale or incomplete data, reloading…');
      snap = null;
    }
  }
  await browser.close();
  if (!snap) { log('FAILED: no fresh snapshot after retries'); process.exit(1); }
  fs.writeFileSync(out, snap.lines.join('\n') + '\n');
  console.log(snap.epoch);
})();
