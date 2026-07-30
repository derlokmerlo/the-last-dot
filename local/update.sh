#!/bin/bash
# Refresh The Last Dot from a machine with a residential IP and publish it.
#
#   scrape FMC (headless Chromium) -> rebuild viz/dist -> force-push the
#   built site as the single commit of the `data` branch -> the deploy-site
#   workflow puts it on GitHub Pages.
#
# Designed to run every 5 minutes from launchd (macOS) or cron (Linux).
# Requires: node, the repo's node_modules (npm i playwright-core), and a
# Playwright Chromium (npx playwright install chromium).
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$REPO/local/.update.lock"
RACE_END=1786320000   # 10 Aug 2026 00:00 UTC — nothing left to update after

[ "$(date -u +%s)" -ge "$RACE_END" ] && { echo "race over — nothing to do"; exit 0; }

# One instance at a time; a lock older than 30 min is stale (crashed run).
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rmdir "$LOCK"' EXIT

cd "$REPO"
echo "=== $(date '+%F %T') scrape"
SNAP="$(mktemp)"
EPOCH=$(node scraper/scrape.js "$SNAP")
node viz/refresh.js "$SNAP" "$EPOCH"
rm -f "$SNAP"

echo "=== publish (data branch)"
TMP="$(mktemp -d)"
cp viz/dist/index.html "$TMP"/
# the workflow file must exist on the pushed branch or the push won't trigger it
mkdir -p "$TMP/.github/workflows"
cp .github/workflows/deploy.yml "$TMP/.github/workflows/"
git -C "$TMP" init -q -b data
git -C "$TMP" add -A
git -C "$TMP" -c user.name="tld-updater" -c user.email="tld-updater@local" \
  commit -q -m "site @ $(date -u '+%F %T UTC')"
git -C "$TMP" -c credential.helper='!gh auth git-credential' \
  push -qf https://github.com/derlokmerlo/the-last-dot.git data:data
rm -rf "$TMP"
echo "=== done"
