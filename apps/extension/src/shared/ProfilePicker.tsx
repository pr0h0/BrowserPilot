import { sendToSw } from "./messaging.js";
import type { Settings } from "./types.js";

/** Saved connection profiles. Picking one makes it the active backendUrl/pairingToken, which the
 *  service worker treats like any other connection change: disconnect, reconnect. */
export function ProfilePicker({ settings, url, token, onChange }: {
  settings: Settings | null; url: string; token: string; onChange: () => void;
}) {
  const profiles = settings?.profiles ?? [];
  const active = profiles.find((p) => p.backendUrl === settings?.backendUrl && p.pairingToken === settings?.pairingToken);

  const save = async (patch: Partial<Settings>) => { await sendToSw({ kind: "saveSettings", settings: patch }); onChange(); };
  const select = (name: string) => {
    const p = profiles.find((x) => x.name === name);
    if (p) void save({ backendUrl: p.backendUrl, pairingToken: p.pairingToken });
  };
  const saveAs = () => {
    const name = prompt("Profile name", active?.name ?? (() => { try { return new URL(url).host; } catch { return ""; } })())?.trim();
    if (!name || !url) return;
    void save({ profiles: [...profiles.filter((p) => p.name !== name), { name, backendUrl: url, pairingToken: token }], backendUrl: url, pairingToken: token });
  };
  const remove = () => {
    if (active && confirm(`Delete profile "${active.name}"?`)) void save({ profiles: profiles.filter((p) => p.name !== active.name) });
  };

  return (
    <div className="row">
      <select value={active?.name ?? ""} onChange={(e) => select(e.target.value)} style={{ flex: 1 }}>
        <option value="" disabled>{profiles.length ? "— unsaved connection —" : "no saved profiles"}</option>
        {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <button className="ghost" onClick={saveAs} title="Save the URL + token below as a profile">Save as…</button>
      <button className="ghost" onClick={remove} disabled={!active} title="Delete the active profile">✕</button>
    </div>
  );
}
