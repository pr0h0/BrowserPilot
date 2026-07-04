import { sendToSw } from "../../shared/messaging.js";
import type { ConsoleEvent } from "../../shared/types.js";

const LEVEL_COLOR: Record<string, string> = { error: "#e74c3c", warning: "#e67e22", info: "#3498db" };

export function ConsolePanel({ events, tabId, onClear }: { events: ConsoleEvent[]; tabId?: number; onClear: () => void }) {
  const clear = async () => { await sendToSw({ kind: "runCommand", commandType: "console.clearRecent", tabId }); onClear(); };
  return (
    <section>
      <h2>Console ({events.length})</h2>
      <div className="row"><button className="ghost" onClick={clear}>Clear</button></div>
      {events.length === 0 ? <div className="muted">No console errors captured.</div> :
        <div style={{ maxHeight: 220, overflow: "auto" }}>
          {events.slice(-50).reverse().map((e, i) => (
            <div key={i} style={{ borderLeft: `3px solid ${LEVEL_COLOR[e.level] ?? "#888"}`, padding: "2px 6px", margin: "3px 0" }}>
              <code>{e.message}</code>
              {e.source && <div className="muted">{e.source}:{e.line ?? "?"}</div>}
            </div>
          ))}
        </div>}
    </section>
  );
}
