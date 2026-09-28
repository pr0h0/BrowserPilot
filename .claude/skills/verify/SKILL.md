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
Expect `ALL E2E CHECKS PASSED` (76 checks): tab gate, live click/type, console capture,
screenshots, coordinate canvas click/hover, workflow record→save→replay, network capture,
`ui.notify` (and that the Settings toggle suppresses it), REST auth rejection, agent
auto/read-only/approve/reject, live streaming + Stop, sensitive-action floor, per-site block,
multi-tab switch, **CDP trusted input, form_input, model override + token usage**, schedules +
activity. Pieces: `test-pages.ts` (:8899 — form, grid, canvas), `scripted-ai.ts` (:9998 fake
OpenAI, fixed tool calls per SCENARIO:* prompt; includes a `usage` block), `e2e.ts` (driver:
REST + CDP on :9222).

**The harness runs WITH auth on** (`PAIRING_TOKEN` pinned in `run.sh`, driver sends Bearer,
extension settings carry it), so a broken auth path fails the suite instead of passing quietly
against an open instance. It also sets `enableDebugger: true`, which is the only way the network
path is reachable.

**Isolation (critical):** the test backend runs on **:9887** with a throwaway DB — NEVER :9876,
where a developer's real browser may be connected. The driver points the test Chrome's extension
at :9887 via a popup `saveSettings` (a SW can't `sendMessage` to itself) and targets **its own
browserId** read from the SW (never `find(online)` — the backend may have several browsers). It
also clears the `127.0.0.1` permission at startup for idempotency.

Coordinate input (`click_at`/`hover_at` on a canvas) is checked on `/canvas.html`. Coords are
SCREENSHOT-IMAGE pixels, divided by the live devicePixelRatio in `commandHandlers.ts`. At dpr 1
that division is the identity, so it proves nothing — re-run the suite with
`CHROME_EXTRA_FLAGS=--force-device-scale-factor=2` to actually exercise the scaling. `run.sh` uses
`xvfb-run` when installed and falls back to `--headless=new` when it isn't.

**Bun loads the root `.env` for every `bun` invocation in this repo**, so a real `PAIRING_TOKEN`
(or model config) leaks into test processes unless overridden. Inline env vars win — that is how
`run.sh` pins its own token and the scripted-model base URL.

**Gotchas:** kill ALL chrome with `pkill -9 -f chrome-linux64/chrome` between runs (a lingering old
instance serves stale extension code and reuses a browserId → baffling failures). `chrome.storage`
in the SW is a singleton but the per-tab gate reads `isTabEnabled` sync — fine as long as only one
browser is targeted. Do NOT `import()` dynamically in the service worker: Vite's preload helper
references `window` and throws — use static imports (cdpInput is statically imported for this).

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

## Things that have bitten, and what they cost
- Two modules each kept their own `chrome.debugger` attach Set (`cdpInput` and
  `debuggerHandlers`). Chrome refuses a second attach from the same extension, so network
  capture failed on any tab already using trusted input — i.e. every tab the agent had
  clicked. One shared registry; don't add a third.
- `registry.touch()` only updates the in-memory session, so the DB's `last_seen_at` records
  when a browser last CONNECTED. `/api/browsers` overlays the live value; don't read the
  column directly and call it liveness.
- A test asserting "every route requires auth" will trip the auth throttle partway through
  and start seeing 429 instead of 401. Reset the limiter between iterations.
- `redactSensitiveData` blanks any key containing "token"/"secret"/"password". Naming an
  audit field `tokenPresented` silently turned a boolean into the string `[REDACTED]`.
