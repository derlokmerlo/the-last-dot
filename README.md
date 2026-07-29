# The Last Dot

**Race against the cut-off** — an interactive time–distance chart of every rider in the
Transcontinental Race No12 (Trondheim → Kalamata, July–August 2026), plotted against the
official finish cut-off of 8 August 2026, 23:59 CEST.

Every rider is a line: their average kilometres per day since the start, projected to the
finish. The black diagonal is the minimum pace required. Above the line is inside the time
limit; below it is not.

## How it updates

A GitHub Actions workflow ([update.yml](.github/workflows/update.yml)) runs every ~5
minutes until the race ends:

1. `scraper/scrape.js` opens the FollowMyChallenge live tracker in headless Chromium
   (the site sits behind a Cloudflare JS challenge, so a real browser is required),
   reads the in-page `ridersArray`, filters tracker artifacts, and emits a
   `name;pos;km;kmPerDay;cat;idlePct;gcFlag` snapshot. A freshness gate compares the
   race chronometer against the wall clock and reloads if the tracker serves stale
   cached data.
2. `viz/refresh.js` swaps the snapshot into the chart source (with sanity gates that
   refuse to publish a broken extraction) and rebuilds `viz/dist/index.html`.
3. The result is deployed to GitHub Pages.

## Sources and method

- Rider data: FollowMyChallenge live leaderboard.
- Start and cut-off times: Lost Dot (marked by them as provisional).
- The projection is linear — km ÷ days elapsed, held constant to the finish. It shows who
  has margin now, not who will actually arrive.
- Colour encoding validated for colour-vision deficiency against both the light and dark
  surfaces (cyan-blue / brick red; red-green pairings were rejected for failing CVD separation).

## Not an official page

*The Last Dot* is an independent dot-watcher's analysis, made by a spectator. It is **not
affiliated with, endorsed by, or connected to Lost Dot or the Transcontinental Race**, and
the name is a nod to dot-watching, not a claim of association. For official information,
results and race reports see [lostdot.cc](https://www.lostdot.cc).
