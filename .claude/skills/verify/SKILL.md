---
name: verify
description: Verify BrowserPilot changes end-to-end — backend via bun test, extension + agent via real Chrome E2E harness in e2e/.
---

# Verifying BrowserPilot

## Fast lane (no browser): unit + integration
```bash
bun run typecheck
bun test packages apps     # protocol units + backend integration (boots real server + fake WS extension)
```

## Full lane: real Chrome E2E (`e2e/`)
Drives the actual unpacked extension in Chrome under Xvfb: tab-control gate, click/type/pressKey
on a live form, console capture (main-world hook), screenshots, and the agent loop
(auto/read-only/approve) with a deterministic scripted model — no real AI key needed.

```bash
# one-time: get a Chrome for Testing binary (regular chrome works too)
# https://googlechromelabs.github.io/chrome-for-testing/  → linux64 chrome zip
CHROME_BIN=/path/to/chrome-linux64/chrome ./e2e/run.sh
```
Expect `ALL E2E CHECKS PASSED` (34 checks): tab gate, live click/type, console capture,
screenshots, agent auto/read-only/approve/reject, live streaming + Stop, sensitive-action floor,
per-site block, multi-tab switch, schedules + activity. Pieces: `test-pages.ts` (:8899 form/result
pages), `scripted-ai.ts` (:9999 fake OpenAI endpoint; fixed tool calls per SCENARIO:* prompt),
`e2e.ts` (driver: REST + CDP on :9222). The driver clears the `127.0.0.1` site permission at
startup so reruns are idempotent — the DB persists between runs.

## Gotchas learned the hard way
- Start long-lived processes with `setsid nohup ... < /dev/null &` — otherwise later shell
  timeouts kill them with the process group.
- CDP `Runtime.evaluate` userGesture works in *page* contexts, not the service worker —
  to open the side panel, click the popup's button (the harness does this).
- Multiple test tabs share URLs; always target tabs by id from `tabs.open`, not by CDP URL match.
- The MAIN-world console hook is a static file (`apps/extension/public/mainWorldHook.js`)
  registered by the SW — CRXJS loaders cannot run in the main world (no `chrome.runtime`).
- Never persist screenshot dataUrls to the DB, and `redactText` skips >100k strings —
  both once wedged the backend (200MB DB, O(n²) regex on base64).
