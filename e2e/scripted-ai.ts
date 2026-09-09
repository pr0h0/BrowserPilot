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

// Validate OpenAI message ordering the way strict providers (DeepSeek) do: every assistant
// tool_calls message must be immediately followed by a tool message per tool_call_id.
function badOrdering(messages: any[]): string | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const need = new Set(m.tool_calls.map((tc: any) => tc.id));
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") { need.delete(messages[j].tool_call_id); j++; }
      if (need.size) return `assistant@${i} tool_calls [${[...need]}] not answered; next roles: ${messages.slice(i, i + 4).map((x: any) => x.role).join(",")}`;
    }
  }
  return null;
}

const SAI_PORT = Number(process.env.SAI_PORT ?? 9999);
Bun.serve({
  port: SAI_PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/chat/completions") {
      const body = await req.json() as any;
      lastRequest = body;
      const bad = badOrdering(body.messages);
      if (bad) return Response.json({ error: { message: `insufficient tool messages following tool_calls message — ${bad}`, type: "invalid_request_error" } }, { status: 400 });
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
      // Policy: hover_at is allowed in every mode (it commits nothing), click_at is gated as an
      // action. In read-only that means hover succeeds and the coordinate click is refused.
      if (userText.includes("SCENARIO:hovergate")) {
        switch (toolCount) {
          case 0: return Response.json(tc("hover_at", { x: 200, y: 150 }));
          case 1: return Response.json(tc("click_at", { x: 200, y: 150, label: "canvas target" }));
          default: return Response.json(final("HOVERGATE DONE"));
        }
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
      // find + efficiency: use find() to locate a button, then click it. The click result must
      // carry the updated "page" field (auto-attach), which the model reports back.
      if (userText.includes("SCENARIO:find")) {
        const toolMsgs = body.messages.filter((m: any) => m.role === "tool");
        if (toolCount === 0) return Response.json(tc("find", { query: "greet button" }));
        if (toolCount === 1) {
          // read the find result to get the selector (proves find returned it)
          const findRes = JSON.parse(toolMsgs[0].content.replace(/<\/?untrusted_page_content[^>]*>/g, "").replace(/^\s*\[!\][^\n]*\n/, "").trim());
          const sel = findRes.matches?.find((m: any) => m.selector === "#greet")?.selector ?? findRes.matches?.[0]?.selector;
          return Response.json(tc("click", { selector: sel }));
        }
        // after the click, the tool result includes "page" (auto-attached fresh elements)
        const clickMsg = toolMsgs[toolCount - 1].content;
        const hasPage = clickMsg.includes('"page"');
        return Response.json(final(`FIND DONE page-attached:${hasPage}`));
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
console.log(`scripted AI on http://127.0.0.1:${SAI_PORT}`);
