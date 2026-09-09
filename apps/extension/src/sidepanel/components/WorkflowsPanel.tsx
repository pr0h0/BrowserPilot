import { useEffect, useState, useCallback } from "react";
import { makeApi } from "../../shared/api.js";
import { sendToSw } from "../../shared/messaging.js";

interface Step { type: string; payload?: Record<string, unknown>; label?: string }
interface Workflow { id: string; name: string; steps: Step[]; createdAt: number; lastRunAt: number | null; lastStatus: string | null }

export function WorkflowsPanel({ backendUrl, token, browserId, tabId }:
  { backendUrl?: string; token?: string; browserId?: string; tabId?: number }) {
  const api = makeApi(backendUrl, token);
  const [rows, setRows] = useState<Workflow[]>([]);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<Step[] | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api.ok) return;
    try { setRows(await api.get("/api/workflows")); setErr(""); } catch (e) { setErr(String(e)); }
  }, [backendUrl, token]);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    if (tabId == null) { setErr("No active tab."); return; }
    const r = await sendToSw({ kind: "runCommand", commandType: "page.startRecorder", tabId });
    if (!r.ok) { setErr(r.error); return; }
    setDraft(null); setErr(""); setRecording(true);
  };

  const stop = async () => {
    if (tabId == null) return;
    const r = await sendToSw({ kind: "runCommand", commandType: "page.stopRecorder", tabId });
    setRecording(false);
    if (!r.ok) { setErr(r.error); return; }
    const steps = ((r.data as any)?.steps ?? []) as Step[];
    setDraft(steps);
    if (!steps.length) setErr("Nothing was recorded — the page may need control enabled first.");
  };

  const save = async () => {
    if (!draft?.length || !name.trim()) { setErr("Name the workflow first."); return; }
    setBusy(true);
    try { await api.post("/api/workflows", { name: name.trim(), steps: draft }); setDraft(null); setName(""); load(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const run = async (wf: Workflow) => {
    if (!browserId) { setErr("No connected browser."); return; }
    setBusy(true);
    try { await api.post(`/api/workflows/${wf.id}/run`, { browserId, tabId }); load(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const del = async (wf: Workflow) => { try { await api.del(`/api/workflows/${wf.id}`); load(); } catch (e) { setErr(String(e)); } };
  const dropStep = (i: number) => setDraft((d) => (d ? d.filter((_, n) => n !== i) : d));

  return (
    <section className="pad">
      <h2>Workflows</h2>
      <div className="muted tiny">
        Record yourself doing a task once, then replay it. Steps are captured as stable selectors,
        so a recording survives page reloads and navigation.
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        {recording ? (
          <>
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="dot" style={{ background: "#e74c3c" }} />
              <b>Recording…</b>
            </div>
            <div className="muted tiny" style={{ marginTop: 4 }}>
              Do the task in the page now. Passwords are never recorded.
            </div>
            <button style={{ marginTop: 8 }} onClick={stop}>Stop recording</button>
          </>
        ) : (
          <button onClick={start} disabled={tabId == null}>● Record a workflow</button>
        )}
      </div>

      {draft && (
        <div className="card" style={{ marginTop: 8 }}>
          <b>{draft.length} step{draft.length === 1 ? "" : "s"} recorded</b>
          <ol className="tiny" style={{ margin: "6px 0", paddingLeft: 18 }}>
            {draft.map((st, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {st.label ?? st.type}
                <button className="ghost sm" style={{ marginLeft: 6 }} title="Remove this step" onClick={() => dropStep(i)}>✕</button>
              </li>
            ))}
          </ol>
          <div className="row" style={{ gap: 6 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" />
            <button onClick={save} disabled={busy || !draft.length}>Save</button>
            <button className="ghost" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}

      {err && <div className="muted tiny" style={{ color: "#e67e22", marginTop: 8 }}>{err}</div>}

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((wf) => (
          <div key={wf.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{wf.name}</b>
              <span className="muted tiny">{wf.steps.length} steps</span>
            </div>
            {wf.lastRunAt && (
              <div className="muted tiny">
                last run {new Date(wf.lastRunAt).toLocaleString()} · {wf.lastStatus}
              </div>
            )}
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="ghost sm" onClick={() => run(wf)} disabled={busy}>▶ Run</button>
              <button className="ghost sm" onClick={() => del(wf)}>Delete</button>
            </div>
          </div>
        ))}
        {!rows.length && !draft && <div className="muted tiny">No saved workflows yet.</div>}
      </div>
    </section>
  );
}
