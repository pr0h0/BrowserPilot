import { useState } from "react";
import { sendToSw } from "../../shared/messaging.js";

const TOOLS: Array<[string, string, unknown?]> = [
  ["Extract text", "page.extractText", { maxChars: 20000 }],
  ["Extract HTML", "page.extractHTML"],
  ["Extract links", "page.extractLinks"],
  ["Extract forms", "page.extractForms"],
  ["Extract tables", "page.extractTables"],
  ["Capture screenshot", "tabs.captureVisible"],
];

export function PageTools({ tabId }: { tabId?: number }) {
  const [out, setOut] = useState<unknown>(null);
  const [busy, setBusy] = useState("");

  const run = async (type: string, payload?: unknown) => {
    setBusy(type); setOut(null);
    const r = await sendToSw({ kind: "runCommand", commandType: type, tabId, payload });
    setBusy("");
    setOut(r.ok ? r.data : { error: r.error });
  };

  const isShot = out && typeof out === "object" && (out as any).dataUrl;

  return (
    <section>
      <h2>Page tools</h2>
      <div className="row">
        {TOOLS.map(([label, type, payload]) => (
          <button key={type} className="ghost" disabled={!!busy} onClick={() => run(type, payload)}>{busy === type ? "…" : label}</button>
        ))}
      </div>
      <div className="row">
        <button className="ghost" onClick={() => run("page.startElementPicker")}>Start picker</button>
        <button className="ghost" onClick={() => run("page.stopElementPicker")}>Stop picker</button>
      </div>
      {isShot ? <img src={(out as any).dataUrl} alt="screenshot" style={{ maxWidth: "100%", borderRadius: 6 }} />
        : out != null && <pre>{JSON.stringify(out, null, 2).slice(0, 4000)}</pre>}
    </section>
  );
}
