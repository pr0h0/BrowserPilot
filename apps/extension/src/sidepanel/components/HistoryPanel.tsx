import { useEffect, useState, useCallback } from "react";
import { makeApi } from "../../shared/api.js";

interface Item { id: string; action: string; details: any; at: number }

const ICON: Record<string, string> = {
  "agent:run": "🤖", "agent:done": "✅", "agent:approve": "👍", "agent:stop": "🛑",
  "browser:connected": "🔌", "browser:disconnected": "⚡", "permission:set": "🔒",
  "permission:clear": "🔓", "schedule:run": "⏰", "schedule:create": "⏰", "auth:rejected": "🚫",
};
const timeAgo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export function HistoryPanel({ backendUrl, token, browserId }: { backendUrl?: string; token?: string; browserId?: string }) {
  const api = makeApi(backendUrl, token);
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!api.ok || !browserId) return;
    try { const r = await api.get(`/api/activity?browserId=${browserId}&limit=80`); setItems(r.items ?? []); setErr(""); }
    catch (e) { setErr(String(e)); }
  }, [backendUrl, token, browserId]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  const summarize = (it: Item): string => {
    const d = it.details ?? {};
    if (it.action === "agent:run") return d.prompt ?? "";
    if (it.action === "agent:done") return d.answer ?? "";
    if (it.action.startsWith("command:")) return `${it.action.slice(8)}${d.error ? ` — ${d.error.code}` : ""}`;
    if (it.action.startsWith("permission")) return `${d.domain ?? ""} ${d.mode ?? ""}`;
    if (it.action.startsWith("schedule")) return `${d.name ?? ""}${d.status ? ` — ${d.status}` : ""}`;
    return "";
  };

  return (
    <section className="pad">
      <h2>Activity</h2>
      {items.length === 0 ? <div className="muted">No activity yet.</div> :
        <div className="list">
          {items.map((it) => (
            <div key={it.id} className="row listrow" style={{ alignItems: "flex-start" }}>
              <span style={{ flex: "none" }}>{ICON[it.action] ?? "•"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div><b className="tiny">{it.action}</b> <span className="muted tiny">{timeAgo(it.at)}</span></div>
                {summarize(it) && <div className="muted tiny ellipsis2">{summarize(it)}</div>}
              </span>
            </div>
          ))}
        </div>}
      {err && <div className="muted err">{err}</div>}
    </section>
  );
}
