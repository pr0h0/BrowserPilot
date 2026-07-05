import { useEffect, useState, useCallback } from "react";
import { makeApi } from "../../shared/api.js";

interface Sched {
  id: string; name: string; prompt: string; mode: string; intervalMinutes: number;
  enabled: boolean; lastRunAt: number | null; lastStatus: string | null; nextRunAt: number;
}

export function TasksPanel({ backendUrl, token, browserId, tabId }:
  { backendUrl?: string; token?: string; browserId?: string; tabId?: number }) {
  const api = makeApi(backendUrl, token);
  const [rows, setRows] = useState<Sched[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [every, setEvery] = useState(60);
  const [mode, setMode] = useState<"auto" | "read">("auto");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!api.ok) return;
    try { setRows(await api.get("/api/schedules")); setErr(""); } catch (e) { setErr(String(e)); }
  }, [backendUrl, token]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || !prompt.trim() || !browserId) { setErr("Name, prompt, and a connected browser required."); return; }
    try {
      await api.post("/api/schedules", { name, prompt, browserId, tabId, mode, intervalMinutes: Number(every) });
      setName(""); setPrompt(""); load();
    } catch (e) { setErr(String(e)); }
  };
  const toggle = async (s: Sched) => { try { await api.patch(`/api/schedules/${s.id}`, { enabled: !s.enabled }); load(); } catch (e) { setErr(String(e)); } };
  const del = async (s: Sched) => { try { await api.del(`/api/schedules/${s.id}`); load(); } catch (e) { setErr(String(e)); } };

  return (
    <section className="pad">
      <h2>Scheduled tasks</h2>
      <div className="muted tiny">Run a prompt on a repeating interval. Scheduled runs act autonomously but <b>refuse</b> sensitive actions (no one to approve).</div>

      <div className="card" style={{ marginTop: 8 }}>
        <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="task name" /></div>
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Check the status page for incidents" />
        <div className="row">
          <label className="tiny">every</label>
          <input style={{ maxWidth: 64, flex: "none" }} type="number" min={1} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
          <label className="tiny">min</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="auto">act</option><option value="read">read only</option>
          </select>
          <button onClick={create}>Add</button>
        </div>
      </div>

      <div className="list">
        {rows.length === 0 && <div className="muted">No scheduled tasks.</div>}
        {rows.map((s) => (
          <div key={s.id} className="card">
            <div className="row between">
              <b>{s.name}</b>
              <span className="row" style={{ gap: 4 }}>
                <span className={`pill ${s.enabled ? "good" : ""}`}>{s.enabled ? "on" : "off"}</span>
                <button className="ghost sm" onClick={() => toggle(s)}>{s.enabled ? "Pause" : "Resume"}</button>
                <button className="ghost sm danger" onClick={() => del(s)}>✕</button>
              </span>
            </div>
            <div className="muted tiny prewrap">{s.prompt}</div>
            <div className="muted tiny">every {s.intervalMinutes}m · {s.mode}{s.lastStatus ? ` · last: ${s.lastStatus}` : " · not run yet"}</div>
          </div>
        ))}
      </div>
      {err && <div className="muted err">{err}</div>}
    </section>
  );
}
