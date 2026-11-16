import { useState, useEffect, useCallback } from "react";
import { sendToSw } from "../../shared/messaging.js";

const TOOLS: Array<[string, string, unknown?]> = [
  ["Extract text", "page.extractText", { maxChars: 20000 }],
  ["Extract HTML", "page.extractHTML"],
  ["Extract links", "page.extractLinks"],
  ["Extract forms", "page.extractForms"],
  ["Extract tables", "page.extractTables"],
  ["Capture screenshot", "tabs.captureVisible"],
];

interface Frame { frameId: number; parentFrameId: number; url: string }

/** Frames in tree order (parents before their children) with their nesting depth. */
export function frameTree(frames: Frame[]): Array<Frame & { depth: number }> {
  const out: Array<Frame & { depth: number }> = [];
  const walk = (parent: number, depth: number) => {
    for (const f of frames.filter((x) => x.parentFrameId === parent)) { out.push({ ...f, depth }); walk(f.frameId, depth + 1); }
  };
  walk(-1, 0);
  return out;
}
// Keep the query: same-page iframes (widgets, embeds) often differ only there.
const shortUrl = (u: string) => { try { const x = new URL(u); return (x.host + x.pathname + x.search).slice(0, 70); } catch { return u.slice(0, 70); } };

export function PageTools({ tabId }: { tabId?: number }) {
  const [out, setOut] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  const [frames, setFrames] = useState<Array<Frame & { depth: number }>>([]);
  const [frameId, setFrameId] = useState(0);

  // Only worth a picker when the page actually has iframes. Fails quietly on a tab without control.
  const loadFrames = useCallback(async () => {
    const r = await sendToSw({ kind: "runCommand", commandType: "page.listFrames", tabId });
    const tree = r.ok ? frameTree(((r.data as any)?.frames ?? []) as Frame[]) : [];
    setFrames(tree);
    setFrameId((cur) => (tree.some((f) => f.frameId === cur) ? cur : 0));
  }, [tabId]);
  useEffect(() => { void loadFrames(); }, [loadFrames]);

  const run = async (type: string, payload?: unknown) => {
    setBusy(type); setOut(null);
    // Screenshots are of the whole tab; everything else runs in the chosen frame.
    const r = await sendToSw({ kind: "runCommand", commandType: type, tabId, frameId: type.startsWith("tabs.") ? undefined : frameId, payload });
    setBusy("");
    setOut(r.ok ? r.data : { error: r.error });
  };

  const isShot = out && typeof out === "object" && (out as any).dataUrl;

  return (
    <section>
      <h2>Page tools</h2>
      {frames.length > 1 && (
        <div className="row">
          <select value={frameId} onChange={(e) => setFrameId(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} title="Which document the tools below run in">
            {frames.map((f) => (
              <option key={f.frameId} value={f.frameId}>
                {f.frameId === 0 ? "Top document" : `${"\u00a0\u00a0".repeat(f.depth)}↳ ${shortUrl(f.url)}`}
              </option>
            ))}
          </select>
          <button className="ghost sm" onClick={loadFrames} title="Re-read the page's iframes">↻</button>
        </div>
      )}
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
