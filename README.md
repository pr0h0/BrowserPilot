# BrowserPilot

A private **Chrome extension + backend** that lets you drive your own browser from a
backend over WebSocket: open/close/reload tabs, read page content, pick elements,
click/type/scroll, capture screenshots, collect console errors and network requests,
record and replay workflows, and run an AI agent that can act on the page using the
current DOM, a selected element, a screenshot, and console/network context.

It is built for **one owner controlling their own browser** for dev/debug/testing.

## 1. What it is

- **Extension (Manifest V3)** connects *outbound* to a backend you run, shows live
  connection status, and lets you disconnect or toggle per-tab control at any time.
- **Backend (Bun + Fastify + `ws` + SQLite/Drizzle)** sends structured, Zod-validated
  JSON commands to the extension and exposes a REST API.
- **CLI** (`browserpilot`) drives the same REST API from your terminal.

```
CLI ──┐
      ├─► Backend REST :9876 ──► WebSocket /ws ──► Extension SW ──► Content script ──► Page
AI ───┘                        (commands + responses + events)
```

## 2. Security model

- The extension only connects to a backend URL **you** type in (default
  `ws://localhost:9876/ws`).
- **Pairing token**: set `PAIRING_TOKEN` on the backend and the same token in the
  extension. The `hello` handshake includes it; a wrong/missing token is rejected.
- **The REST API requires the same token** (`Authorization: Bearer <PAIRING_TOKEN>`,
  or `X-Pairing-Token`). Only `GET /health` is open, and it reports nothing about how
  the instance is configured. The check is a global hook keyed on a `PUBLIC_ROUTES`
  set, so routes added later are protected by default rather than by remembering.
- **Auth fails closed.** With no `PAIRING_TOKEN` configured, *nothing* authenticates —
  every request and connection is rejected. Set `ALLOW_NO_TOKEN=1` to run an instance
  with no auth at all; that is for local dev and the E2E harness, never for anything
  another machine can reach.
- **Failed-auth throttle**: 10 failures per IP per 15 minutes, on REST and WS. The token
  is checked *first*, so a stranger hammering your endpoint can never lock you out of
  your own instance. Throttled requests are not written to the audit log, which stops a
  spray from amplifying into DB writes.
- **CORS** allows extension origins plus anything you list in `CORS_ORIGINS`. It does not
  reflect arbitrary origins, so a page you happen to visit cannot try its luck against
  your localhost backend.
- The backend binds **127.0.0.1** by default. Set `HOST=0.0.0.0` only if you
  deliberately want it reachable from other machines (then use a strong token).
  To publish it on a hostname, see [§13 Exposing it beyond localhost](#13-exposing-it-beyond-localhost).
- Commands map to a **fixed allow-list of handlers** (`COMMAND_TYPES`). There is no
  raw-JS execution path.
- **Per-tab control**: page extraction/actions are refused unless you enabled control
  for that tab (`TAB_NOT_ENABLED`). Safe tab management + capture are always allowed.
- **Per-site permissions** (agent): each domain is `ask` (default — approve each action),
  `always` (act without asking), or `blocked` (never act). Banking/auth hosts are blocked
  out of the box; extend with `BLOCKED_SITES`. Managed in the side panel's Settings → Site
  permissions, or `POST /api/permissions`.
- **Sensitive-action floor**: purchases, payments, deleting/publishing/sharing always
  require explicit approval — even in Autonomous mode. In scheduled runs (no human) they
  are refused outright.
- **Hard floor beneath that**: payments, account creation, identity data (SSN/passport/tax
  id) and irreversible deletes are never auto-approved. Autonomous mode and an "always
  allow" site do not lift it — a human says yes each time. Card numbers (Luhn-checked) and
  SSNs are refused outright in every mode, since unlike a password field they arrive as
  ordinary text into ordinary inputs where the input type tells you nothing.
- **Prompt-injection defense**: page-derived text/DOM is fenced in `<untrusted_page_content>`
  and the model is told to treat it as data, never instructions. When the heuristic flags a
  page, that is *acted on* rather than merely noted: the run drops out of autonomous mode
  and asks before each action until it navigates away. The warning inside the fence is
  addressed to the model, and the model is exactly what a successful injection has already
  subverted.
- **Redaction**: sensitive headers/fields (`authorization`, `cookie`, `token`,
  `password`, `api_key`, …) are replaced with `[REDACTED]` in logs, DB, and AI context,
  including secret-shaped substrings inside free text.
- Password fields are never typed into or exported; HTML extraction redacts password /
  token / secret inputs.
- The extension status is always visible; an emergency **Disconnect** button is in both
  the popup and side panel.
- Every command and connection event is written to an `audit_logs` table, including failed
  auth attempts with their source IP, method and path. Check for intruders with
  `GET /api/activity?action=auth` (the `action` filter matches on prefix).

## 3. What it intentionally does NOT do

No stealth/hidden persistence, no cookie export, no password/credential extraction, no
arbitrary remote JavaScript execution, no detection evasion. It is not a botnet client —
it is a visible, owner-driven tool.

## 4. Installation

Requires **[Bun](https://bun.sh) ≥ 1.3** and Chrome.

```bash
bun install
cp .env.example .env        # then edit .env (AI keys optional)
```

## 5. Run the backend

```bash
bun run dev:backend         # http://localhost:9876, ws://localhost:9876/ws
# health check (the only route that needs no token):
curl localhost:9876/health
```

> **Set `PAIRING_TOKEN` in `.env` first.** Auth fails closed: with no token configured the
> backend rejects every request and connection, which looks like a broken install. For a
> deliberately open local instance, set `ALLOW_NO_TOKEN=1` instead.

SQLite tables are created automatically on boot. Screenshots are written to
`apps/backend/data/screenshots/`.

## 6. Load the Chrome extension (unpacked)

```bash
bun run dev:extension       # dev mode with HMR  (recommended while developing)
#   …or for a static build:
bun run build               # outputs apps/extension/dist
```

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select:
   - `apps/extension/dist` (after `bun run build`), or
   - the dev build folder printed by `bun run dev:extension`.
4. Pin the extension and click it to open the popup.

> If a tab was already open before you loaded the extension, **reload that tab** so the
> content script is injected.

## 7. Set the backend URL in the extension

In the popup or side panel:
- **Backend URL** — default `ws://localhost:9876/ws`.
- **Browser name** — anything you like.
- Click **Save**, then **Connect**. The status dot turns green when connected.
- A warning appears if the URL is neither localhost nor `wss://`.
- **Profiles** — to switch between servers (say `wss://pilot.example/ws` and `ws://localhost:9876/ws`,
  each with its own token), fill in the URL and token and click **Save as…**. Pick a profile from the
  dropdown to make it active, and the extension reconnects to that server. **✕** deletes the active profile.

Open the side panel from the popup's **Open side panel** button.

## 8. Pairing token

1. Backend: set `PAIRING_TOKEN=your-secret` in `.env` and restart.
2. Extension: enter the same value in the **Pairing token** field, Save, Connect.
3. Wrong/missing token → connection rejected. With no `PAIRING_TOKEN` set the backend
   rejects *everything*; use `ALLOW_NO_TOKEN=1` for a deliberately open local instance.
4. The same token guards the REST API: `curl -H 'authorization: Bearer your-secret' …`.
   The CLI reads it from `BROWSERPILOT_TOKEN` (or `PAIRING_TOKEN`); the extension's
   Chat tab sends the token you saved in settings.

## 9. CLI examples

The CLI talks to the backend (`BROWSERPILOT_URL`, default `http://localhost:9876`).
If a `PAIRING_TOKEN` is set, export `BROWSERPILOT_TOKEN=<token>` (or `PAIRING_TOKEN`).
If exactly one browser is connected, `--browser` can be omitted.

```bash
bun run cli health
bun run cli browsers
bun run cli tabs --browser <id>
bun run cli active-tab
bun run cli open https://example.com
bun run cli reload --tab 12
bun run cli close --tab 12
bun run cli screenshot --tab 12
bun run cli text --tab 12
bun run cli links --tab 12
bun run cli forms --tab 12
bun run cli picker --tab 12
bun run cli click  --tab 12 --selector "button.submit"     # tab control must be enabled
bun run cli type   --tab 12 --selector "input[name=email]" --text "test@example.com"
bun run cli ask "Summarize this page" --attach-page
bun run cli ask "Why is this page broken?" --attach-page --attach-console --attach-screenshot
```

(`bun run cli` is shorthand for `bun --filter @browserpilot/cli start --`.)

Notes: `type` **replaces** the field's current value (send `"append": true` in the
command payload to append instead). `page.pressKey` with `Enter` submits the
surrounding form; other keys only fire synthetic events, which most sites ignore.

## 10. REST API examples

Every route except `/health` needs the pairing token, so export it once:

```bash
export T=$(grep '^PAIRING_TOKEN=' .env | cut -d= -f2-)
alias bp='curl -s -H "authorization: Bearer $T"'
```

```bash
curl localhost:9876/health                       # the one public route
bp localhost:9876/api/browsers
bp localhost:9876/api/browsers/<id>/tabs

# send any command:
bp -X POST localhost:9876/api/browsers/<id>/commands \
  -H 'content-type: application/json' \
  -d '{"type":"tabs.open","payload":{"url":"https://example.com","active":true}}'

# iframes (any depth): list the frame tree, then aim any page.* command at a frameId
bp -X POST localhost:9876/api/browsers/<id>/commands -H 'content-type: application/json' \
  -d '{"type":"page.listFrames","target":{"tabId":12}}'        # → frameId, parentFrameId, url
bp -X POST localhost:9876/api/browsers/<id>/commands -H 'content-type: application/json' \
  -d '{"type":"page.click","target":{"tabId":12,"frameId":7},"payload":{"selector":"#submit"}}'

bp localhost:9876/api/commands/<commandId>
bp 'localhost:9876/api/logs/console?browserId=<id>'
bp 'localhost:9876/api/logs/network?browserId=<id>'

# who connected, and who failed to:
bp 'localhost:9876/api/activity?action=browser'   # connects / disconnects
bp 'localhost:9876/api/activity?action=auth'      # rejected + locked-out attempts, with IPs

# AI chat with page + console context:
bp -X POST localhost:9876/api/chat -H 'content-type: application/json' \
  -d '{"browserId":"<id>","tabId":12,"prompt":"What is wrong here?","attachments":{"pageText":true,"console":true}}'

# run an ad-hoc workflow (saved ones: §11d):
bp -X POST localhost:9876/api/workflows/run -H 'content-type: application/json' -d '{
  "browserId":"<id>","name":"Smoke test login",
  "steps":[
    {"type":"tabs.open","payload":{"url":"https://example.com/login"}},
    {"type":"page.waitForSelector","payload":{"selector":"form"}},
    {"type":"tabs.captureVisible"},
    {"type":"console.getRecent"}
  ]}'
```

## 11. AI provider configuration

Set in `.env`. Four providers are supported:

| Provider   | `AI_PROVIDER` | `OPENAI_BASE_URL`              | example `OPENAI_MODEL`        |
|------------|---------------|-------------------------------|-------------------------------|
| OpenAI     | `openai`      | `https://api.openai.com/v1`   | `gpt-4.1-mini`                |
| DeepSeek   | `deepseek`    | `https://api.deepseek.com`    | `deepseek-flash`              |
| OpenRouter | `openrouter`  | `https://openrouter.ai/api/v1`| `openai/gpt-4o-mini`          |
| Anthropic  | `anthropic`   | `https://api.anthropic.com`   | `claude-opus-5`               |

- **Use a model that accepts image input.** The agent sends screenshots as image blocks,
  so on a text-only model `screenshot`, `click_at` and `hover_at` are dead weight — the
  run wastes turns capturing pictures nothing can see.
- OpenAI / DeepSeek / OpenRouter share the OpenAI chat-completions wire format — only
  the base URL, model, and key differ. Any local OpenAI-compatible server (LM Studio,
  Ollama, vLLM) works the same way.
- Anthropic uses its native `/v1/messages` API. Put the Anthropic key in
  `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`). The system prompt is sent with
  `cache_control`, so repeat turns bill at cache-read rates; check
  `usage.cache_read_input_tokens` if you want to confirm it is working.
- `AI_MAX_TOKENS` (default `16000`) caps output per turn. Don't tune it low on a
  **reasoning model** (e.g. `deepseek-flash`): reasoning tokens are spent before any
  visible content, so a tight cap returns an empty answer rather than a short one.
- No key configured → `/api/chat` returns `AI_NOT_CONFIGURED` (everything else still works).

## 11b. AI agent (clicking / typing)

The **Chat** tab is an agent: it can *act* on the page, not just describe it. Its tools:
read — `list_interactive`, `find` (ranked candidates for a plain-language description),
`extract_text`, `get_console`, `get_network`, `get_selected_element`, `wait_for`, `scroll`,
`screenshot` (the model *sees* the captured image), `list_tabs`, `hover_at`;
act — `click`, `click_at`, `type`, `set_field` (checkboxes/selects/radios), `press_key`,
`navigate`, `switch_tab`, `drag`, `upload_file`, `download`. To click "the red Buy button", it
calls `list_interactive` (which returns each element's selector **and rendered color/text**),
matches your description, then calls `click` with the exact selector — no coordinate guessing.
Multi-step and **multi-tab** tasks work: it can `list_tabs`, `switch_tab`, navigate, `wait_for`
the new page, re-list, and continue. Each run is grounded with the current page, and the panel
sends recent chat history so follow-ups keep context.

`get_console` shows the symptom, `get_network` shows the failing request behind it (status,
URL, timing, redacted headers) — capture starts when first called, so an empty list means
reload and ask again.

**Canvas and other no-DOM targets** (games, maps, charts, video controls): when
`list_interactive` returns nothing for something you can plainly see, the target is painted
pixels, not an element. `hover_at(x, y)` moves the real pointer without clicking so the page
renders its own hover state — that highlight, not the model's estimate, is the evidence it is
aimed correctly — then `click_at(x, y)` commits. Coordinates are pixels in the **screenshot
image**, scaled by the live devicePixelRatio before dispatch, and both go through CDP only:
a synthetic event at a point is not the same thing, so they fail loudly rather than quietly
downgrading. Selectors are still preferred wherever an element exists — coordinates go stale
the moment anything re-lays-out.

Runs are **asynchronous and streamed**: `POST /api/agent/run` returns a `runId` immediately,
the panel polls `GET /api/agent/events?runId=&since=` to show each tool call live, and a **Stop**
button (`POST /api/agent/stop`) ends a run mid-flight.

**Trusted input** (Settings → Agent, on by default): clicks and typing go through the Chrome
debugger as real `isTrusted` events, so they work on sites that ignore synthetic clicks (React,
canvas, anti-bot). This shows a "debugging this browser" banner; untick it to fall back to
synthetic events. **Model** and **Max steps** are also set there, and the chat shows **token
usage** per turn. Type **/** in the composer for **saved prompts** (Save as /prompt to add one).

Right-click selected text → **Ask BrowserPilot about "…"** opens the panel with it prefilled.
Keyboard shortcut **Ctrl/⌘+Shift+U** opens the side panel.

**Autonomy** is a dropdown in the Chat tab:

| Mode | Behaviour |
|---|---|
| **Read-only** | Reads page/console; clicks & types are refused (enforced server-side, not just hidden). |
| **Approve actions** | Proposes each click/type; you press **Approve**/**Reject** in the panel before it runs. |
| **Autonomous** | Acts on its own — but only on tabs where you enabled control. |

Hard floor in every mode: the AI can only act on a tab you've **enabled control** for (the same
`TAB_NOT_ENABLED` gate the CLI hits), only on sites that aren't `blocked`, and sensitive actions
always ask. Tick **Screenshot** to give the model visual context (needs a vision model).

## 11c. Scheduled tasks

Settings → Scheduled tasks (or `POST /api/schedules`) runs a prompt on a repeating interval.
Scheduled runs act autonomously but **refuse** sensitive actions (no one is there to approve) and
respect the site blocklist. The **Activity** tab (`GET /api/activity`) shows a live feed of agent
runs, approvals, permission changes, and scheduled runs.

## 11d. Workflows: record once, replay

The **Flows** tab records what you actually do on a page and turns it into a replayable
workflow — no hand-written step lists.

1. **Record a workflow** → do the task in the page. Clicks, typing, dropdowns and checkboxes
   are captured as steps using the same verified-unique selectors the agent clicks with.
2. **Stop** → review the steps, drop any you don't want, name it, **Save**.
3. **▶ Run** replays it against the current tab.

Details worth knowing:
- Typing is recorded as one step per field (flushed when focus leaves or you press Enter),
  not one per keystroke. **Password fields are never recorded.**
- The buffer lives in the service worker, so a recording survives navigation — walk through
  a multi-page flow and the page changes are recorded as `tabs.navigate` steps.
- Steps are re-validated against the command allow-list when saved; the extension is not
  trusted to hand the backend arbitrary commands to replay later.
- REST: `GET/POST /api/workflows`, `DELETE /api/workflows/:id`, `POST /api/workflows/:id/run`.
  `POST /api/workflows/run` still takes an ad-hoc step list without saving it.

## 11e. Notifications

The agent loop runs in the backend, so a run that pauses for approval is invisible whenever
the side panel is closed — which is most of the time. BrowserPilot raises a desktop
notification when a run **needs approval**, and when a run **longer than 30 seconds**
finishes (shorter ones would just be noise while you are watching the panel).

Toggle in **Settings → Desktop notifications**. Scheduled runs never notify — nobody is
watching, and they refuse rather than pause.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Extension won't connect | Backend running? URL exactly `ws://localhost:9876/ws`? Token matches? |
| `TAB_NOT_ENABLED` | Toggle **Enable control on this tab** in the popup/side panel. |
| `CONTENT_SCRIPT_FAILED` / no response | Reload the page so the content script loads; it can't run on `chrome://` pages. |
| `COMMAND_TIMEOUT` | The tab/page didn't respond in time; raise `timeoutMs` in the command. |
| `AI_NOT_CONFIGURED` | Set the AI env vars (section 11) and restart the backend. |
| `SCREENSHOT_FAILED` | The target tab must be the active tab in its window. |
| Network capture empty / `get_network` returns nothing | Tick **Enable network capture / deep console** in Settings, then reload the page. Capture only records from the moment it is switched on, so the first call after enabling is legitimately empty. |
| `401 UNAUTHORIZED` on REST | Send the pairing token: `-H 'authorization: Bearer <PAIRING_TOKEN>'` (CLI: `BROWSERPILOT_TOKEN`). With no `PAIRING_TOKEN` configured the backend rejects everything — that is deliberate; set one, or `ALLOW_NO_TOKEN=1` for a local open instance. |
| `429 TOO_MANY_ATTEMPTS` | 10 failed auth attempts from your IP in 15 minutes. A *correct* token still works while throttled, so this means the token is actually wrong. |
| `PERMISSION_DENIED` on `click_at` / `drag` / `upload_file` | These need trusted input (the Chrome debugger). Enable **Trusted input** in Settings. |
| Agent takes screenshots but ignores them | The configured model has no vision. See §11. |
| No desktop notifications | Settings → **Desktop notifications**, and check Chrome isn't muting the extension at OS level. |
| Coordinate clicks land at double the offset | A HiDPI scaling bug — `click_at` takes *screenshot-image* pixels, not CSS pixels. Re-read the screenshot's `imageWidth`/`imageHeight`. |

## 13. Exposing it beyond localhost

**Think before you do this.** The API can drive a browser that is logged into your accounts.
A token-holder can list your tabs, navigate them, and screenshot whatever is on screen —
`tabs.list` and `tabs.captureVisible` need no per-tab control and no approval. Treat the
pairing token like the password to every site you are signed into.

Minimum bar:

1. **A real token.** `python3 -c 'import secrets;print(secrets.token_urlsafe(48))'` into
   `PAIRING_TOKEN`, and leave `ALLOW_NO_TOKEN` unset so a missing token fails closed.
2. **TLS.** `wss://` and `https://` only — a token over plain `ws://` is a published token.
3. **`TRUST_PROXY=1`** so the auth throttle sees real client IPs. Only safe behind a proxy
   that *overwrites* `X-Forwarded-For`; if it forwards the client's header untouched,
   anyone can forge the IP the throttle counts.
4. **An identity layer in front** (Cloudflare Access, Tailscale, a VPN). The token is one
   static string with no rotation or expiry; if it leaks it is valid forever.

A Cloudflare tunnel needs no inbound port at all:

```bash
cloudflared tunnel create pilot
cloudflared --config ~/.cloudflared/pilot.yml tunnel route dns pilot pilot.example.com
```

```yaml
# ~/.cloudflared/pilot.yml
tunnel: <uuid from create>
credentials-file: /home/you/.cloudflared/<uuid>.json
ingress:
  - hostname: pilot.example.com
    service: http://localhost:9876
    originRequest:
      connectTimeout: 30s
      disableChunkedEncoding: false   # /ws is long-lived; don't cut agent runs short
  - service: http_status:404
```

> **Always pass `--config` when routing DNS.** Without it `cloudflared` reads the default
> `~/.cloudflared/config.yml` and attaches your hostname to whatever tunnel *that* file
> names, silently. Add `--overwrite-dns` to fix a record that went to the wrong tunnel.

Run it under systemd (`Restart=always`), then point the extension at
`wss://pilot.example.com/ws` with the token. Verify before trusting it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://pilot.example.com/health        # 200
curl -s -o /dev/null -w '%{http_code}\n' https://pilot.example.com/api/browsers  # 401
```

## Project layout

Monorepo (Bun workspaces): `packages/protocol` (shared Zod schemas/types),
`apps/backend` (Fastify + WS + SQLite), `apps/cli`, `apps/extension` (MV3 + React/Vite),
`e2e` (real-Chrome harness: test pages, scripted model, driver).

The side panel has six tabs: **Chat** (the agent), **Tools**, **Flows** (workflow
recording), **Console**, **Activity**, **Settings**.

## Configuration reference

All backend settings live in `.env` (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `9876` / `127.0.0.1` | Listen address. Widen `HOST` only deliberately. |
| `PAIRING_TOKEN` | *(empty)* | Shared secret for REST + WS. Empty ⇒ everything is rejected. |
| `ALLOW_NO_TOKEN` | unset | `1` runs with **no authentication**. Local dev and the E2E harness only. |
| `TRUST_PROXY` | unset | `1` behind a reverse proxy, so the auth throttle sees real client IPs. |
| `CORS_ORIGINS` | *(empty)* | Extra browser origins allowed to call the API. Extension origins always are. |
| `BLOCKED_SITES` | *(empty)* | Extra domains the agent may never act on, comma-separated. |
| `DATABASE_URL` | `file:./data/browserpilot.sqlite` | Resolved against `apps/backend`, not the CWD. |
| `SCREENSHOT_DIR` | `./data/screenshots` | Same. |
| `AI_PROVIDER` | `openai` | `openai` \| `deepseek` \| `openrouter` \| `anthropic`. |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | — | See §11. The model must accept image input. |
| `AI_MAX_TOKENS` | `16000` | Output ceiling per agent turn. |

## Testing

```bash
bun run typecheck
bun test packages apps                          # protocol units + backend integration
CHROME_BIN=/path/to/chrome ./e2e/run.sh         # real Chrome, real extension, scripted model
```

The E2E harness drives the actual unpacked extension against an **isolated backend on :9887**
with a throwaway DB, and runs **with auth enabled** so a broken auth path fails the suite.
It uses `xvfb-run` when present and `--headless=new` otherwise. Coordinate scaling is only
genuinely exercised at a non-1 device pixel ratio:

```bash
CHROME_EXTRA_FLAGS=--force-device-scale-factor=2 ./e2e/run.sh
```

> Bun auto-loads the root `.env` for *any* `bun` invocation in this repo, so a real
> `PAIRING_TOKEN` will leak into test processes unless overridden. Inline env vars take
> precedence, which is how `run.sh` pins its own token.

## Scripts

```bash
bun run dev:backend     # backend with --watch
bun run dev:extension   # extension dev build (HMR)
bun run build           # build all (extension → dist)
bun run typecheck       # typecheck all packages
bun test packages apps  # unit + integration tests
bun run db:generate     # optional: drizzle migrations
bun run cli <command>   # run the CLI
```
