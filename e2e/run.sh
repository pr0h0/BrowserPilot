#!/usr/bin/env bash
# Full E2E: real Chrome + unpacked extension + scripted model + an ISOLATED backend.
# The backend runs on :9887 with a throwaway DB so it never touches a real backend on
# :9887's neighbour :9876 (a developer's own browser may be connected there). The driver
# points the test Chrome's extension at :9887 and targets only its own browserId.
# Requires: bun, xvfb-run, CHROME_BIN → a Chrome/Chromium binary.
set -e
cd "$(dirname "$0")/.."
: "${CHROME_BIN:?set CHROME_BIN to a Chrome/Chromium binary}"

bun --filter @browserpilot/extension build

fuser -k 9887/tcp 9222/tcp 8899/tcp 9999/tcp 2>/dev/null || true
sleep 0.5
PROFILE=$(mktemp -d)
TESTDB=$(mktemp -d)/e2e.sqlite

bun e2e/test-pages.ts & PAGES=$!
bun e2e/scripted-ai.ts & SAI=$!
PORT=9887 DATABASE_URL="file:$TESTDB" SCREENSHOT_DIR="$(dirname "$TESTDB")/shots" \
  AI_PROVIDER=openai OPENAI_API_KEY=fakekey OPENAI_BASE_URL=http://127.0.0.1:9999/v1 OPENAI_MODEL=scripted \
  bun apps/backend/src/index.ts & BACK=$!
xvfb-run -a -s "-screen 0 1280x900x24" "$CHROME_BIN" \
  --no-sandbox --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" --load-extension="$PWD/apps/extension/dist" \
  --remote-debugging-port=9222 about:blank & CHROME=$!
trap 'kill $PAGES $SAI $BACK $CHROME 2>/dev/null; rm -rf "$PROFILE" "$(dirname "$TESTDB")"' EXIT

echo "waiting for the test backend..."
for _ in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:9887/health >/dev/null 2>&1 && break; sleep 1; done

E2E_API=http://127.0.0.1:9887 E2E_WS=ws://127.0.0.1:9887/ws bun e2e/e2e.ts
