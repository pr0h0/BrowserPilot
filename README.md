# BrowserPilot

A private **Chrome extension + backend** that lets you drive your own browser from a
backend over WebSocket: open/close/reload tabs, read page content, pick elements,
click/type/scroll, capture screenshots, collect console errors, and chat with an AI
that can use the current page, a selected element, a screenshot, and console errors as
context.

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
  With no token set, connections are allowed **only** when `NODE_ENV=development`.
- **The REST API requires the same token** (`Authorization: Bearer <PAIRING_TOKEN>`,
  or `X-Pairing-Token`). Only `GET /health` is open. Without a token configured,
  REST works only in `NODE_ENV=development`.
- The backend binds **127.0.0.1** by default. Set `HOST=0.0.0.0` only if you
  deliberately want it reachable from other machines (then use a strong token).
- Commands map to a **fixed allow-list of handlers** (`COMMAND_TYPES`). There is no
  raw-JS execution path.
- **Per-tab control**: page extraction/actions are refused unless you enabled control
  for that tab (`TAB_NOT_ENABLED`). Safe tab management + capture are always allowed.
- **Redaction**: sensitive headers/fields (`authorization`, `cookie`, `token`,
  `password`, `api_key`, …) are replaced with `[REDACTED]` in logs, DB, and AI context.
- Password fields are never typed into or exported; HTML extraction redacts password /
  token / secret inputs.
- The extension status is always visible; an emergency **Disconnect** button is in both
  the popup and side panel.
- Every command and connection event is written to an `audit_logs` table.

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
# health check:
curl localhost:9876/health
```

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

Open the side panel from the popup's **Open side panel** button.

## 8. Pairing token

1. Backend: set `PAIRING_TOKEN=your-secret` in `.env` and restart.
2. Extension: enter the same value in the **Pairing token** field, Save, Connect.
3. Wrong/missing token → connection rejected. In `NODE_ENV=development` an empty token
   is accepted for convenience.
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

```bash
curl localhost:9876/health
curl localhost:9876/api/browsers
curl localhost:9876/api/browsers/<id>/tabs

# send any command:
curl -X POST localhost:9876/api/browsers/<id>/commands \
  -H 'content-type: application/json' \
  -d '{"type":"tabs.open","payload":{"url":"https://example.com","active":true}}'

curl localhost:9876/api/commands/<commandId>
curl 'localhost:9876/api/logs/console?browserId=<id>'
curl 'localhost:9876/api/logs/network?browserId=<id>'

# AI chat with page + console context:
curl -X POST localhost:9876/api/chat -H 'content-type: application/json' \
  -d '{"browserId":"<id>","tabId":12,"prompt":"What is wrong here?","attachments":{"pageText":true,"console":true}}'

# workflow:
curl -X POST localhost:9876/api/workflows/run -H 'content-type: application/json' -d '{
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
| DeepSeek   | `deepseek`    | `https://api.deepseek.com`    | `deepseek-chat`               |
| OpenRouter | `openrouter`  | `https://openrouter.ai/api/v1`| `openai/gpt-4o-mini`          |
| Anthropic  | `anthropic`   | `https://api.anthropic.com`   | `claude-3-5-sonnet-latest`    |

- OpenAI / DeepSeek / OpenRouter share the OpenAI chat-completions wire format — only
  the base URL, model, and key differ. Any local OpenAI-compatible server (LM Studio,
  Ollama, vLLM) works the same way.
- Anthropic uses its native `/v1/messages` API. Put the Anthropic key in
  `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`).
- Vision (the **screenshot** attachment) works on OpenAI-compatible and Anthropic.
- No key configured → `/api/chat` returns `AI_NOT_CONFIGURED` (everything else still works).

## 11b. AI agent (clicking / typing)

The **Chat** tab is an agent: it can *act* on the page, not just describe it. It has tools
(`list_interactive`, `extract_text`, `get_console`, `get_selected_element`, `click`, `type`)
and runs a tool-calling loop. To click "the red Buy button", it calls `list_interactive`
(which returns each element's selector **and rendered color/text**), matches your description,
then calls `click` with the exact selector — no coordinate guessing.

**Autonomy** is a dropdown in the Chat tab:

| Mode | Behaviour |
|---|---|
| **Read-only** | Reads page/console; clicks & types are refused (enforced server-side, not just hidden). |
| **Approve actions** | Proposes each click/type; you press **Approve**/**Reject** in the panel before it runs. |
| **Autonomous** | Acts on its own — but only on tabs where you enabled control. |

Hard floor in every mode: the AI can only act on a tab you've **enabled control** for (the same
`TAB_NOT_ENABLED` gate the CLI hits). Tick **Screenshot** to also give the model visual context
(needs a vision model). REST: `POST /api/agent/run` then `POST /api/agent/approve`.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Extension won't connect | Backend running? URL exactly `ws://localhost:9876/ws`? Token matches? |
| `TAB_NOT_ENABLED` | Toggle **Enable control on this tab** in the popup/side panel. |
| `CONTENT_SCRIPT_FAILED` / no response | Reload the page so the content script loads; it can't run on `chrome://` pages. |
| `COMMAND_TIMEOUT` | The tab/page didn't respond in time; raise `timeoutMs` in the command. |
| `AI_NOT_CONFIGURED` | Set the AI env vars (section 11) and restart the backend. |
| `SCREENSHOT_FAILED` | The target tab must be the active tab in its window. |
| Network capture empty | Off by default. Chrome forbids `debugger` as an *optional* permission, so to use `network.*`/deep console: add `"debugger"` to the `permissions` array in `apps/extension/manifest.json`, rebuild, reload, then tick **Enable debugger features** in the side panel's Connection tab and Save. (This adds a Chrome install warning — that's why it's opt-in.) |
| `401 UNAUTHORIZED` on REST | Send the pairing token: `-H 'authorization: Bearer <PAIRING_TOKEN>'` (CLI: `BROWSERPILOT_TOKEN`). |

## Project layout

Monorepo (Bun workspaces): `packages/protocol` (shared Zod schemas/types),
`apps/backend` (Fastify + WS + SQLite), `apps/cli`, `apps/extension` (MV3 + React/Vite).

## Scripts

```bash
bun run dev:backend     # backend with --watch
bun run dev:extension   # extension dev build (HMR)
bun run build           # build all (extension → dist)
bun run typecheck       # typecheck all packages
bun run db:generate     # optional: drizzle migrations
bun run cli <command>   # run the CLI
```
