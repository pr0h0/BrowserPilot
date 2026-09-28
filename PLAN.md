> **Historical.** This is the original build brief the project was generated from, kept for
> provenance. It does not describe the current system — the stack moved to Bun (not pnpm/Node),
> and the agent, workflow recording, coordinate input and security model have all moved well past
> what is written here. **See `README.md` for how BrowserPilot actually works today.**

You are an expert full-stack TypeScript engineer. Build a complete working app named **BrowserPilot** from start to end.

BrowserPilot is a private Chrome Extension + backend app that allows a user-controlled Chrome extension to connect outbound to a backend over WebSocket. The backend can then send structured commands to the extension to control the browser: open/close/reload tabs, list tabs, read page content, select elements, click/type/scroll, capture screenshots, collect console errors, optionally collect network requests, and provide an AI chat that can use the current page, selected elements, screenshots, console errors, and network errors as context.

This is for the owner’s own browser/dev/testing workflow only. Do not implement stealth behavior, hidden persistence, cookie dumping, password extraction, credential theft, or arbitrary remote JavaScript execution. The extension must visibly show connection/control status and allow the user to disconnect.

Build the project as a monorepo.

Tech stack:

* Language: TypeScript everywhere.
* Package manager: pnpm.
* Backend runtime: Node.js 22+.
* Backend framework: Fastify.
* WebSocket library: `ws`.
* Validation: Zod.
* Database: SQLite using Drizzle ORM.
* CLI: Node TypeScript CLI using `tsx` or compiled JS.
* Chrome extension: Manifest V3.
* Extension UI: React + Vite.
* Extension pages:

  * Side panel
  * Popup
  * Options page if useful
* Extension parts:

  * MV3 service worker
  * Content script
  * Injected page helper if needed
  * Element picker overlay
* AI integration:

  * OpenAI-compatible API client using env vars.
  * Support `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.
  * Must also work with OpenRouter, DeepSeek-compatible endpoints, or local OpenAI-compatible servers.
* No separate web dashboard for v1.
* Control surfaces are:

  * Chrome extension side panel
  * Backend REST API
  * CLI commands

Required repository structure:

```txt
browserpilot/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── .env.example
├── apps/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── config.ts
│   │       ├── db/
│   │       │   ├── schema.ts
│   │       │   ├── client.ts
│   │       │   └── migrations/
│   │       ├── ws/
│   │       │   ├── wsServer.ts
│   │       │   ├── connectionRegistry.ts
│   │       │   └── commandRouter.ts
│   │       ├── api/
│   │       │   ├── browsers.ts
│   │       │   ├── commands.ts
│   │       │   ├── chat.ts
│   │       │   ├── logs.ts
│   │       │   └── workflows.ts
│   │       ├── services/
│   │       │   ├── aiService.ts
│   │       │   ├── commandService.ts
│   │       │   ├── screenshotStore.ts
│   │       │   ├── auditLogService.ts
│   │       │   └── workflowRunner.ts
│   │       └── util/
│   │           ├── ids.ts
│   │           ├── redaction.ts
│   │           └── logger.ts
│   │
│   ├── cli/
│   │   ├── package.json
│   │   └── src/
│   │       └── index.ts
│   │
│   └── extension/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── manifest.json
│       ├── public/
│       └── src/
│           ├── service-worker/
│           │   ├── index.ts
│           │   ├── socketClient.ts
│           │   ├── commandHandlers.ts
│           │   ├── tabHandlers.ts
│           │   ├── screenshotHandlers.ts
│           │   ├── debuggerHandlers.ts
│           │   └── storage.ts
│           ├── content/
│           │   ├── index.ts
│           │   ├── pageExtractors.ts
│           │   ├── elementPicker.ts
│           │   ├── actionExecutor.ts
│           │   └── consoleCapture.ts
│           ├── sidepanel/
│           │   ├── main.tsx
│           │   ├── App.tsx
│           │   └── components/
│           ├── popup/
│           │   ├── main.tsx
│           │   └── App.tsx
│           └── shared/
│               ├── browserApi.ts
│               ├── messaging.ts
│               └── types.ts
│
└── packages/
    └── protocol/
        ├── package.json
        └── src/
            ├── index.ts
            ├── schemas.ts
            └── types.ts
```

Core architecture:

1. The Chrome extension must connect outbound to the backend.
2. The backend must listen on port `9876` by default.
3. The extension settings must let the user enter a backend URL.
4. Default backend URL in extension UI: `ws://localhost:9876/ws`.
5. The backend must expose REST API on `http://localhost:9876`.
6. The extension must automatically reconnect with exponential backoff.
7. The extension must show connection status in the popup and side panel.
8. The extension must have a manual disconnect button.
9. The extension must have a manual “Enable control on this tab” / “Disable control on this tab” switch.
10. All commands must be structured JSON validated with Zod.
11. Do not implement raw remote JavaScript execution.
12. Do not implement cookie export.
13. Do not extract password fields.
14. Redact sensitive headers and values from logs.

Backend behavior:

* Start Fastify on `PORT`, default `9876`.
* WebSocket endpoint: `/ws`.
* REST API endpoints:

  * `GET /health`
  * `GET /api/browsers`
  * `GET /api/browsers/:browserId`
  * `GET /api/browsers/:browserId/tabs`
  * `POST /api/browsers/:browserId/commands`
  * `GET /api/commands/:commandId`
  * `GET /api/logs/console`
  * `GET /api/logs/network`
  * `POST /api/chat`
  * `POST /api/workflows/run`
* CLI must call these REST endpoints.

Connection model:

When the extension connects, it sends:

```json
{
  "type": "hello",
  "browserId": "generated-or-saved-browser-id",
  "browserName": "User editable browser name",
  "extensionVersion": "0.1.0",
  "capabilities": [
    "tabs",
    "scripting",
    "screenshots",
    "page-extract",
    "element-picker",
    "basic-console",
    "basic-actions",
    "ai-chat"
  ]
}
```

Backend responds:

```json
{
  "type": "hello.ack",
  "ok": true,
  "serverTime": "ISO_DATE",
  "sessionId": "session_xxx"
}
```

Implement heartbeat:

* Extension sends ping every 20 seconds.
* Backend replies pong.
* Any WebSocket message should reset local last-seen time.
* Backend marks browser offline if no heartbeat for 60 seconds.

Protocol package:

Create shared Zod schemas for all messages.

Base command:

```ts
{
  id: string;
  type: string;
  target?: {
    tabId?: number;
    browserId?: string;
  };
  payload?: unknown;
  timeoutMs?: number;
}
```

Base response:

```ts
{
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

Implement these command types first:

Tab commands:

* `tabs.list`
* `tabs.open`
* `tabs.close`
* `tabs.reload`
* `tabs.activate`
* `tabs.getActive`
* `tabs.navigate`
* `tabs.goBack`
* `tabs.goForward`
* `tabs.captureVisible`

Page extraction commands:

* `page.extractText`
* `page.extractHTML`
* `page.extractMetadata`
* `page.extractLinks`
* `page.extractImages`
* `page.extractForms`
* `page.extractTables`
* `page.getSelection`
* `page.getSelectedElement`
* `page.startElementPicker`
* `page.stopElementPicker`

Page action commands:

* `page.click`
* `page.type`
* `page.clear`
* `page.focus`
* `page.pressKey`
* `page.scroll`
* `page.hover`
* `page.waitForSelector`
* `page.waitForText`

Console commands:

* `console.getRecent`
* `console.clearRecent`

AI commands:

* `ai.askCurrentPage`
* `ai.askSelectedElement`
* `ai.askWithScreenshot`
* `ai.askWithConsole`

Optional phase 2 commands using `chrome.debugger`:

* `debugger.attach`
* `debugger.detach`
* `network.enable`
* `network.disable`
* `network.getRecent`
* `network.clearRecent`
* `console.enableDeep`
* `console.disableDeep`

Chrome extension manifest:

Use Manifest V3.

Permissions for v1:

```json
{
  "permissions": [
    "tabs",
    "activeTab",
    "scripting",
    "storage",
    "sidePanel"
  ]
}
```

Add optional debugger support behind a setting. If using debugger, include:

```json
{
  "permissions": [
    "debugger"
  ]
}
```

Only request broad host permissions if absolutely needed. Prefer `activeTab` and user-invoked control. The user must be able to enable control for the active tab from the side panel or popup.

Extension popup:

Build a small popup with:

* App name: BrowserPilot
* Connection status
* Backend URL input
* Save backend URL button
* Connect button
* Disconnect button
* Current browser ID
* Current browser name
* Enable/disable current tab control
* Open side panel button

Extension side panel:

Build a useful side panel with these sections:

1. Connection

   * Online/offline
   * Backend URL
   * Browser ID/name
   * Current tab URL/title
   * Enable control toggle

2. Chat

   * Textarea prompt input
   * Buttons:

     * Ask
     * Attach current page text
     * Attach selected element
     * Attach screenshot
     * Attach console errors
   * Streaming or normal response display
   * Chat history in local extension state

3. Page tools

   * Extract visible text
   * Extract HTML
   * Extract links
   * Extract forms
   * Extract tables
   * Capture screenshot
   * Start element picker
   * Stop picker

4. Selected element

   * Show tag
   * Show text
   * Show selector
   * Show XPath
   * Show bounding box
   * Copy selector
   * Send to AI

5. Console

   * Show recent captured errors and unhandled promise rejections
   * Clear button

Element picker:

Implement content-script overlay:

* On start, inject picker into active tab.
* Hovering an element highlights it with an outline.
* Show small label with tag, id, class, dimensions.
* Clicking selects the element and prevents default click.
* Pressing Escape cancels picker.
* Selection result must include:

  * tag
  * id
  * classes
  * best CSS selector
  * XPath
  * innerText limited to 10,000 chars
  * outerHTML limited to 20,000 chars
  * boundingClientRect
  * attributes
* Send selected element to service worker, then backend, then side panel.

Page extraction:

For text extraction:

* Return visible text, not scripts/styles.
* Limit output using `maxChars`.
* Default max: 20,000 chars.
* Include page title and URL.

For HTML extraction:

* Remove script contents by default.
* Remove style contents by default.
* Redact inputs:

  * password
  * email optional setting
  * credit-card-like fields
  * hidden tokens where name includes token, csrf, secret, password, key
* Limit output to 50,000 chars by default.

For links:

Return array:

```ts
{
  text: string;
  href: string;
  title?: string;
  target?: string;
}
```

For forms:

Return form action, method, fields, labels, input names/types, but never field values for password fields.

Console capture:

In content script, capture:

* `window.error`
* `unhandledrejection`
* optionally monkey-patch console.error/warn if safe

Store recent events in extension memory and chrome.storage.session if available.

Each console event:

```ts
{
  level: "error" | "warning" | "info";
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: string;
  tabId: number;
  url: string;
}
```

Screenshots:

Implement visible tab screenshot using Chrome tab capture APIs.

Return:

```ts
{
  mimeType: "image/png";
  dataUrl: "data:image/png;base64,...";
  width?: number;
  height?: number;
  url: string;
  title: string;
  timestamp: string;
}
```

Backend should store screenshots on local disk:

```txt
apps/backend/data/screenshots/
```

Store DB row with file path, browserId, tabId, URL, title, timestamp.

Backend database schema:

Use Drizzle with SQLite.

Tables:

1. `browsers`

   * id
   * name
   * extensionVersion
   * capabilitiesJson
   * status
   * lastSeenAt
   * createdAt
   * updatedAt

2. `commands`

   * id
   * browserId
   * tabId nullable
   * type
   * payloadJson
   * status: pending/sent/succeeded/failed/timeout
   * resultJson nullable
   * errorJson nullable
   * createdAt
   * completedAt nullable

3. `screenshots`

   * id
   * browserId
   * tabId nullable
   * url
   * title
   * filePath
   * mimeType
   * createdAt

4. `console_events`

   * id
   * browserId
   * tabId nullable
   * url
   * level
   * message
   * source nullable
   * line nullable
   * column nullable
   * stack nullable
   * createdAt

5. `network_events`

   * id
   * browserId
   * tabId nullable
   * url
   * method
   * status nullable
   * requestUrl
   * errorText nullable
   * durationMs nullable
   * requestHeadersJson nullable redacted
   * responseHeadersJson nullable redacted
   * createdAt

6. `chat_threads`

   * id
   * browserId nullable
   * tabId nullable
   * title
   * createdAt
   * updatedAt

7. `chat_messages`

   * id
   * threadId
   * role: user/assistant/system/tool
   * content
   * contextJson nullable
   * createdAt

8. `audit_logs`

   * id
   * browserId nullable
   * action
   * detailsJson
   * createdAt

Redaction:

Implement `redactSensitiveData()` used by backend and extension.

Redact:

* `authorization`
* `cookie`
* `set-cookie`
* `x-api-key`
* `x-shopify-access-token`
* `api_key`
* `access_token`
* `refresh_token`
* `password`
* `secret`
* `private_key`
* `csrf`
* `token`

Replace with `[REDACTED]`.

REST command endpoint:

`POST /api/browsers/:browserId/commands`

Input:

```json
{
  "type": "tabs.open",
  "target": {},
  "payload": {
    "url": "https://example.com",
    "active": true
  },
  "timeoutMs": 30000
}
```

Behavior:

* Validate with Zod.
* Check browser connected.
* Create command row.
* Send command over WebSocket.
* Wait for response until timeout.
* Store result.
* Return result.

Response:

```json
{
  "ok": true,
  "commandId": "cmd_xxx",
  "result": {}
}
```

CLI:

Create `browserpilot` CLI with commands:

```bash
browserpilot health
browserpilot browsers
browserpilot tabs --browser <id>
browserpilot active-tab --browser <id>
browserpilot open --browser <id> <url>
browserpilot reload --browser <id> --tab <tabId>
browserpilot close --browser <id> --tab <tabId>
browserpilot screenshot --browser <id> --tab <tabId>
browserpilot text --browser <id> --tab <tabId>
browserpilot html --browser <id> --tab <tabId>
browserpilot links --browser <id> --tab <tabId>
browserpilot forms --browser <id> --tab <tabId>
browserpilot picker --browser <id> --tab <tabId>
browserpilot click --browser <id> --tab <tabId> --selector "button"
browserpilot type --browser <id> --tab <tabId> --selector "input[name=email]" --text "test@example.com"
browserpilot ask --browser <id> --tab <tabId> "Summarize this page" --attach-page
browserpilot ask --browser <id> --tab <tabId> "Why is this page broken?" --attach-page --attach-console --attach-screenshot
```

If only one browser is connected, CLI may use it by default.

Backend AI chat:

Implement `POST /api/chat`.

Input:

```json
{
  "browserId": "br_xxx",
  "tabId": 123,
  "prompt": "Explain this page",
  "attachments": {
    "pageText": true,
    "selectedElement": true,
    "screenshot": false,
    "console": true,
    "network": false
  }
}
```

Backend behavior:

1. If `pageText` requested, send `page.extractText` command.
2. If `selectedElement` requested, use last selected element from extension state or request current selection.
3. If `screenshot` requested, send `tabs.captureVisible`.
4. If `console` requested, send `console.getRecent`.
5. Build context.
6. Send to OpenAI-compatible model.
7. Store chat messages.
8. Return AI answer.

AI system prompt:

“You are BrowserPilot, a browser debugging assistant. Use the provided browser context only as diagnostic context. Do not request or expose passwords, cookies, session tokens, or secrets. When suggesting browser actions, prefer safe, reversible steps. If context is insufficient, say what additional page information is needed.”

Workflows:

Implement a simple JSON workflow runner.

Endpoint:

`POST /api/workflows/run`

Input:

```json
{
  "browserId": "br_xxx",
  "name": "Smoke test login page",
  "steps": [
    {
      "type": "tabs.open",
      "payload": {
        "url": "https://example.com/login"
      }
    },
    {
      "type": "page.waitForSelector",
      "payload": {
        "selector": "form"
      }
    },
    {
      "type": "tabs.captureVisible"
    },
    {
      "type": "console.getRecent"
    }
  ]
}
```

Runner behavior:

* Execute steps sequentially.
* Pass previous result into next step as `lastResult`.
* If a step fails, stop by default.
* Return full timeline.
* Store command rows.

Security requirements:

* Extension connects to backend URL chosen by user.
* Default backend URL: `ws://localhost:9876/ws`.
* Warn if backend URL is not localhost and not WSS.
* Add pairing token support:

  * Backend has `PAIRING_TOKEN` env var.
  * Extension UI has token input.
  * WebSocket hello includes token.
  * Backend rejects connection if token incorrect.
  * In development, allow empty token only when `NODE_ENV=development`.
* Do not execute arbitrary JS strings from backend.
* Commands must map to known handlers only.
* Do not export cookies.
* Do not extract password values.
* Do not hide extension status.
* Add command audit logging.
* Add per-tab control enablement.
* Extension should reject page action/extraction commands for tabs that are not enabled, except safe `tabs.list`, `tabs.getActive`, and tab management commands.
* Add emergency disconnect button.
* Redact sensitive data before sending to AI.

Implementation details for extension:

Service worker:

* Owns WebSocket connection.
* Reads backend URL from `chrome.storage.local`.
* Reads pairing token from `chrome.storage.local`.
* Reconnects with exponential backoff.
* Sends hello on connect.
* Sends heartbeat ping.
* Receives commands.
* Dispatches commands to handlers.
* For page extraction/actions, communicates with content script.
* Ensures content script is injected when needed using `chrome.scripting.executeScript`.
* Handles tab APIs.
* Handles screenshot APIs.
* Stores current connection status.

Content script:

* Responds to messages from service worker:

  * extract text
  * extract HTML
  * extract links
  * extract forms
  * extract tables
  * start/stop picker
  * click/type/scroll/wait
  * get selection
  * get selected element
  * get console recent
* Maintains selected element state.
* Maintains recent console errors.
* Avoids breaking page behavior.
* Picker must clean up overlays and event listeners.

Side panel:

* Uses Chrome runtime messaging to communicate with service worker.
* Shows connection status.
* Lets user edit backend URL and pairing token.
* Lets user connect/disconnect.
* Lets user enable control for current tab.
* Lets user start picker.
* Lets user send AI chat prompts.
* Lets user attach page/selected element/screenshot/console.
* Shows latest selected element.
* Shows recent console errors.
* Shows AI response.

Popup:

* Minimal quick controls:

  * status
  * connect/disconnect
  * backend URL
  * enable current tab
  * open side panel

Backend implementation details:

* Keep an in-memory map of connected browser sessions.
* Each session has browserId, ws, capabilities, lastSeenAt.
* Command router sends command and returns promise.
* Store pending commands with timeout.
* Resolve promise when extension sends response with same command ID.
* On disconnect, fail pending commands.
* Persist command lifecycle in DB.
* Add structured logs.

Error handling:

Use consistent error codes:

```txt
BROWSER_OFFLINE
COMMAND_TIMEOUT
INVALID_COMMAND
TAB_NOT_FOUND
TAB_NOT_ENABLED
PERMISSION_DENIED
CONTENT_SCRIPT_FAILED
AI_NOT_CONFIGURED
AI_REQUEST_FAILED
SCREENSHOT_FAILED
PICKER_CANCELLED
UNKNOWN_ERROR
```

README requirements:

Write a complete README with:

1. What BrowserPilot is.
2. Security model.
3. What it intentionally does not do.
4. Installation.
5. How to run backend.
6. How to load Chrome extension unpacked.
7. How to set backend URL in extension.
8. How pairing token works.
9. CLI examples.
10. API examples with curl.
11. AI provider configuration.
12. Troubleshooting.

Environment variables:

`.env.example`:

```env
NODE_ENV=development
PORT=9876
DATABASE_URL=file:./data/browserpilot.sqlite
PAIRING_TOKEN=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
SCREENSHOT_DIR=./data/screenshots
```

Scripts:

Root package scripts:

```json
{
  "scripts": {
    "dev": "pnpm -r dev",
    "dev:backend": "pnpm --filter @browserpilot/backend dev",
    "dev:extension": "pnpm --filter @browserpilot/extension dev",
    "dev:cli": "pnpm --filter @browserpilot/cli dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "db:generate": "pnpm --filter @browserpilot/backend db:generate",
    "db:migrate": "pnpm --filter @browserpilot/backend db:migrate"
  }
}
```

Acceptance criteria:

The app is complete when all of this works:

1. `pnpm install` succeeds.
2. `pnpm dev:backend` starts backend on `localhost:9876`.
3. `GET /health` returns ok.
4. Extension builds with `pnpm dev:extension` or `pnpm build`.
5. User can load extension unpacked in Chrome.
6. Extension defaults to `ws://localhost:9876/ws`.
7. User can change backend URL in popup/side panel.
8. Extension connects to backend.
9. Backend `GET /api/browsers` shows connected extension.
10. CLI `browserpilot browsers` shows connected browser.
11. CLI can list tabs.
12. CLI can open a tab.
13. CLI can reload a tab.
14. CLI can close a tab.
15. CLI can capture visible screenshot.
16. Side panel can extract page text.
17. Side panel can start element picker.
18. Picking element shows selector/text/html preview in side panel.
19. CLI can extract page text.
20. CLI can click a selector after tab control is enabled.
21. CLI can type into a selector after tab control is enabled.
22. Console errors are captured and visible.
23. AI chat works when API env vars are configured.
24. AI chat gracefully reports `AI_NOT_CONFIGURED` when env vars are missing.
25. Sensitive values are redacted.
26. Commands are stored in SQLite.
27. Screenshots are stored on disk.
28. README explains everything clearly.

Development approach:

* First create the monorepo and shared protocol package.
* Then backend health, WebSocket, browser registry.
* Then extension service worker connection.
* Then popup/sidepanel connection settings.
* Then tab commands.
* Then page extraction.
* Then element picker.
* Then screenshots.
* Then console capture.
* Then CLI.
* Then AI chat.
* Then workflow runner.
* Then persistence/audit logs.
* Then README and final polish.

Do not stop at scaffolding. Implement the actual working functionality. Keep code clean, typed, and modular. Where Chrome APIs are unavailable in tests/dev, add graceful error messages rather than crashing.

