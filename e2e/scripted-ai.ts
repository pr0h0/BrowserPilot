// Scripted OpenAI-compatible "model": picks a scenario from the user prompt and emits a fixed
// tool-call sequence, advancing by how many tool results are in the conversation so far.
// This makes the whole agent loop deterministic against a real browser.
let lastRequest: any = null;

const tc = (name: string, args: Record<string, unknown>) => ({
  choices: [{ message: { role: "assistant", content: "", tool_calls: [
    { id: `call_${name}_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
  ] } }],
});
const final = (text: string) => ({ choices: [{ message: { role: "assistant", content: text } }] });

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
        switch (toolCount) {
          case 0: return Response.json(tc("click", { selector: "#greet" }));
          default: return Response.json(final("READONLY DONE"));
        }
      }
      if (userText.includes("SCENARIO:approve")) {
        switch (toolCount) {
          case 0: return Response.json(tc("type", { selector: "#q", text: "approved text" }));
          default: return Response.json(final("APPROVE DONE"));
        }
      }
      return Response.json(final("no scenario"));
    }
    if (url.pathname === "/last") return Response.json(lastRequest ?? {});
    return new Response("nope", { status: 404 });
  },
});
console.log("scripted AI on http://127.0.0.1:9999");
