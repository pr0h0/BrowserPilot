#!/usr/bin/env bun
// BrowserPilot CLI — thin wrapper over the backend REST API.
const BASE = process.env.BROWSERPILOT_URL ?? "http://localhost:9876";

// --- tiny arg parser: collects --flags (with values) and positionals ---
function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else pos.push(a);
  }
  return { flags, pos };
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" }, ...init });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) { console.error(`HTTP ${res.status}:`, typeof body === "string" ? body : JSON.stringify(body, null, 2)); process.exit(1); }
  return body;
}

async function resolveBrowser(flags: Record<string, string | boolean>): Promise<string> {
  if (typeof flags.browser === "string") return flags.browser;
  const browsers = await api("/api/browsers");
  const online = browsers.filter((b: any) => b.online);
  if (online.length === 1) return online[0].id;
  if (online.length === 0) { console.error("No browsers connected. Open the extension and connect."); process.exit(1); }
  console.error("Multiple browsers connected; pass --browser <id>:");
  for (const b of online) console.error(`  ${b.id}  (${b.name})`);
  process.exit(1);
}

function tabId(flags: Record<string, string | boolean>): number | undefined {
  return flags.tab !== undefined ? Number(flags.tab) : undefined;
}

async function cmd(browser: string, type: string, payload?: unknown, tab?: number) {
  return api(`/api/browsers/${browser}/commands`, { method: "POST", body: JSON.stringify({ type, target: tab !== undefined ? { tabId: tab } : {}, payload }) });
}

const out = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));

const HELP = `BrowserPilot CLI
Usage: browserpilot <command> [options]

  health
  browsers
  tabs            --browser <id>
  active-tab      --browser <id>
  open            --browser <id> <url>
  reload          --browser <id> --tab <tabId>
  close           --browser <id> --tab <tabId>
  activate        --browser <id> --tab <tabId>
  screenshot      --browser <id> --tab <tabId>
  text            --browser <id> --tab <tabId>
  html            --browser <id> --tab <tabId>
  links           --browser <id> --tab <tabId>
  forms           --browser <id> --tab <tabId>
  tables          --browser <id> --tab <tabId>
  picker          --browser <id> --tab <tabId>
  click           --browser <id> --tab <tabId> --selector "button"
  type            --browser <id> --tab <tabId> --selector "input" --text "hi"
  ask             --browser <id> --tab <tabId> "prompt" [--attach-page --attach-console --attach-screenshot --attach-element]

If exactly one browser is connected, --browser may be omitted.
Backend URL via BROWSERPILOT_URL (default http://localhost:9876).`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseArgs(rest);
  if (!command || command === "help" || flags.help) return out(HELP);

  switch (command) {
    case "health": return out(await api("/health"));
    case "browsers": return out(await api("/api/browsers"));
    case "tabs": return out((await cmd(await resolveBrowser(flags), "tabs.list")).result);
    case "active-tab": return out((await cmd(await resolveBrowser(flags), "tabs.getActive")).result);
    case "open": {
      const url = pos[0]; if (!url) { console.error("open needs a <url>"); process.exit(1); }
      return out((await cmd(await resolveBrowser(flags), "tabs.open", { url, active: true })).result);
    }
    case "reload": return out((await cmd(await resolveBrowser(flags), "tabs.reload", {}, tabId(flags))).result);
    case "close": return out((await cmd(await resolveBrowser(flags), "tabs.close", {}, tabId(flags))).result);
    case "activate": return out((await cmd(await resolveBrowser(flags), "tabs.activate", {}, tabId(flags))).result);
    case "screenshot": {
      const r = await cmd(await resolveBrowser(flags), "tabs.captureVisible", {}, tabId(flags));
      const res = r.result ?? {};
      return out({ ok: r.ok, url: res.url, width: res.width, height: res.height, storedPath: res.storedPath, screenshotId: res.screenshotId });
    }
    case "text": return out((await cmd(await resolveBrowser(flags), "page.extractText", { maxChars: Number(flags.max ?? 20000) }, tabId(flags))).result);
    case "html": return out((await cmd(await resolveBrowser(flags), "page.extractHTML", {}, tabId(flags))).result);
    case "links": return out((await cmd(await resolveBrowser(flags), "page.extractLinks", {}, tabId(flags))).result);
    case "forms": return out((await cmd(await resolveBrowser(flags), "page.extractForms", {}, tabId(flags))).result);
    case "tables": return out((await cmd(await resolveBrowser(flags), "page.extractTables", {}, tabId(flags))).result);
    case "picker": return out((await cmd(await resolveBrowser(flags), "page.startElementPicker", {}, tabId(flags))).result);
    case "click": return out((await cmd(await resolveBrowser(flags), "page.click", { selector: flags.selector }, tabId(flags))).result);
    case "type": return out((await cmd(await resolveBrowser(flags), "page.type", { selector: flags.selector, text: flags.text }, tabId(flags))).result);
    case "ask": {
      const browser = await resolveBrowser(flags);
      const prompt = pos.join(" ");
      if (!prompt) { console.error("ask needs a prompt"); process.exit(1); }
      const body = {
        browserId: browser, tabId: tabId(flags), prompt,
        attachments: {
          pageText: !!flags["attach-page"], console: !!flags["attach-console"],
          screenshot: !!flags["attach-screenshot"], selectedElement: !!flags["attach-element"],
          network: !!flags["attach-network"],
        },
      };
      const r = await api("/api/chat", { method: "POST", body: JSON.stringify(body) });
      return out(r.answer ?? r);
    }
    default: console.error(`Unknown command: ${command}\n`); return out(HELP);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
