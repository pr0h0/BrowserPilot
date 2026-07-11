// Scripted OpenAI-compatible "model": picks a scenario from the user prompt and emits a fixed
// tool-call sequence, advancing by how many tool results are in the conversation so far.
// This makes the whole agent loop deterministic against a real browser.
let lastRequest: any = null;

// Every response carries a usage block so the driver can verify token accounting.
const USAGE = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
const tc = (name: string, args: Record<string, unknown>) => ({
  usage: USAGE,
  choices: [{ message: { role: "assistant", content: "", tool_calls: [
    { id: `call_${name}_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
  ] } }],
});
const final = (text: string) => ({ usage: USAGE, choices: [{ message: { role: "assistant", content: text } }] });

// Find the most recent list_tabs tool result and return its tabs array.
function lastTabs(messages: any[]): any[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "tool" && typeof m.content === "string" && m.content.includes('"tabs"')) {
      try { return JSON.parse(m.content).tabs ?? []; } catch { return []; }
    }
  }
  return [];
}

Bun.serve({
  port: 9999,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/chat/completions") {
      const body = await req.json() as any;
      lastRequest = body;
      const userText = JSON.stringify(body.messages.filter((m: any) => m.role === "user"));
      const toolCount = body.messages.filter((m: any) => m.role === "tool").length;
      const sawImage = JSON.stringify(body.messages).includes("image_url");

      if (userText.includes("SCENARIO:search")) {
        switch (toolCount) {
          case 0: return Response.json(tc("list_interactive", {}));
          case 1: return Response.json(tc("type", { selector: "#q", text: "hello world" }));
          case 2: return Response.json(tc("press_key", { selector: "#q", key: "Enter" }));
          case 3: return Response.json(tc("wait_for", { selector: "#done", timeoutMs: 8000 }));
          case 4: return Response.json(tc("screenshot", {}));
          default: return Response.json(final(`SEARCH DONE image-seen:${sawImage}`));
        }
      }
      if (userText.includes("SCENARIO:readonly")) {
        return toolCount === 0 ? Response.json(tc("click", { selector: "#greet" })) : Response.json(final("READONLY DONE"));
      }
      if (userText.includes("SCENARIO:approve")) {
        return toolCount === 0 ? Response.json(tc("type", { selector: "#q", text: "approved text" })) : Response.json(final("APPROVE DONE"));
      }
      // Sensitive-action floor: even in auto mode, clicking "Delete account" must pause for approval.
      if (userText.includes("SCENARIO:sensitive")) {
        switch (toolCount) {
          case 0: return Response.json(tc("list_interactive", {})); // caches the "Delete account" label
          case 1: return Response.json(tc("click", { selector: "#danger" }));
          default: return Response.json(final("SENSITIVE DONE"));
        }
      }
      // form_input: check a checkbox and choose a <select> option via set_field.
      if (userText.includes("SCENARIO:form")) {
        switch (toolCount) {
          case 0: return Response.json(tc("set_field", { selector: "#agree", checked: true }));
          case 1: return Response.json(tc("set_field", { selector: "#color", value: "Blue" }));
          default: return Response.json(final("FORM DONE"));
        }
      }
      // Blocked site: the driver blocks 127.0.0.1 first; the click must be refused server-side.
      if (userText.includes("SCENARIO:blocked")) {
        return toolCount === 0 ? Response.json(tc("click", { selector: "#greet" })) : Response.json(final("BLOCKED DONE"));
      }
      // Stop: loop on a read tool (with a server delay) so the driver can stop mid-run.
      if (userText.includes("SCENARIO:loop")) {
        await Bun.sleep(400);
        return Response.json(tc("list_interactive", {}));
      }
      // Steer: loop until a steering user-message ("STEERNOW…") is injected, then finish with it.
      if (userText.includes("SCENARIO:steer")) {
        const steer = body.messages.find((m: any) => m.role === "user" && typeof m.content === "string" && m.content.includes("STEERNOW"));
        if (steer) return Response.json(final(`STEERED:${steer.content}`));
        await Bun.sleep(400);
        return Response.json(tc("list_interactive", {}));
      }
      // Multi-tab: list tabs, switch to the result-page tab, done.
      if (userText.includes("SCENARIO:multitab")) {
        if (toolCount === 0) return Response.json(tc("list_tabs", {}));
        if (toolCount === 1) {
          const target = lastTabs(body.messages).find((t: any) => String(t.url).includes("result.html"));
          return Response.json(tc("switch_tab", { tabId: target?.id ?? -1 }));
        }
        return Response.json(final("MULTITAB DONE"));
      }
      return Response.json(final("no scenario"));
    }
    if (url.pathname === "/last") return Response.json(lastRequest ?? {});
    return new Response("nope", { status: 404 });
  },
});
console.log("scripted AI on http://127.0.0.1:9999");
