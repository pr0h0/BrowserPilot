#!/usr/bin/env bash
# Full E2E: real Chrome + unpacked extension + backend + scripted model.
# Requires: bun, xvfb-run, and CHROME_BIN pointing at a Chrome/Chromium binary
# (Chrome for Testing works: https://googlechromelabs.github.io/chrome-for-testing/).
set -e
cd "$(dirname "$0")/.."
: "${CHROME_BIN:?set CHROME_BIN to a Chrome/Chromium binary}"

bun --filter @browserpilot/extension build

fuser -k 9876/tcp 9222/tcp 8899/tcp 9999/tcp 2>/dev/null || true
sleep 0.5
PROFILE=$(mktemp -d)

bun e2e/test-pages.ts & PAGES=$!
bun e2e/scripted-ai.ts & SAI=$!
AI_PROVIDER=openai OPENAI_API_KEY=fakekey OPENAI_BASE_URL=http://127.0.0.1:9999/v1 OPENAI_MODEL=scripted \
  bun apps/backend/src/index.ts & BACK=$!
xvfb-run -a -s "-screen 0 1280x900x24" "$CHROME_BIN" \
  --no-sandbox --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" --load-extension="$PWD/apps/extension/dist" \
  --remote-debugging-port=9222 about:blank & CHROME=$!
trap 'kill $PAGES $SAI $BACK $CHROME 2>/dev/null; rm -rf "$PROFILE"' EXIT

echo "waiting for the extension to connect..."
for _ in $(seq 1 30); do
  curl -s -m 2 http://127.0.0.1:9876/api/browsers 2>/dev/null | grep -q '"online":true' && break
  sleep 2
done

bun e2e/e2e.ts
