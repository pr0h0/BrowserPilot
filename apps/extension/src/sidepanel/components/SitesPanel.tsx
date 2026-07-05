import { useEffect, useState, useCallback } from "react";
import { makeApi } from "../../shared/api.js";

interface Perm { domain: string; mode: string; updatedAt: number }
const domainOf = (url?: string) => { try { return new URL(url!).hostname; } catch { return ""; } };

export function SitesPanel({ backendUrl, token, pageUrl }: { backendUrl?: string; token?: string; pageUrl?: string }) {
  const api = makeApi(backendUrl, token);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [err, setErr] = useState("");
  const here = domainOf(pageUrl);

  const load = useCallback(async () => {
    if (!api.ok) return;
    try { const r = await api.get("/api/permissions"); setPerms(r.configured ?? []); setBlocked(r.blockedByConfig ?? []); setErr(""); }
    catch (e) { setErr(String(e)); }
  }, [backendUrl, token]);
  useEffect(() => { load(); }, [load]);

  const set = async (domain: string, mode: "always" | "blocked") => {
    if (!domain) return;
    try { await api.post("/api/permissions", { domain, mode }); setNewDomain(""); load(); } catch (e) { setErr(String(e)); }
  };
  const clear = async (domain: string) => { try { await api.del(`/api/permissions/${encodeURIComponent(domain)}`); load(); } catch (e) { setErr(String(e)); } };

  return (
    <section className="pad">
      <h2>Site permissions</h2>
      <div className="muted tiny">Controls what the agent may do on each site. Default is <b>ask</b> (approve each action).</div>

      {here && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="muted">This site: <code>{here}</code></div>
          <div className="row">
            <button className="ghost sm" onClick={() => set(here, "always")}>Always allow</button>
            <button className="ghost sm danger" onClick={() => set(here, "blocked")}>Never allow</button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" />
        <button className="ghost sm" onClick={() => set(newDomain.trim(), "always")}>Allow</button>
        <button className="ghost sm danger" onClick={() => set(newDomain.trim(), "blocked")}>Block</button>
      </div>

      {perms.length > 0 && <div className="list">
        {perms.map((p) => (
          <div key={p.domain} className="row between listrow">
            <span><span className={`pill ${p.mode === "blocked" ? "bad" : "good"}`}>{p.mode}</span> <code>{p.domain}</code></span>
            <button className="ghost sm" onClick={() => clear(p.domain)}>✕</button>
          </div>
        ))}
      </div>}

      {blocked.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted tiny">Always-blocked by config ({blocked.length})</summary>
          <div className="muted tiny">{blocked.join(", ")}</div>
        </details>
      )}
      {err && <div className="muted err">{err}</div>}
    </section>
  );
}
