import { httpBaseFromWs } from "./hooks.js";

/** Build a REST client bound to the backend URL + pairing token from settings.
 *  Panels talk to the backend directly (same origin the agent uses). */
export function makeApi(backendUrl?: string, token?: string) {
  const base = backendUrl ? httpBaseFromWs(backendUrl) : "";
  // content-type only when there's a body — Fastify rejects an empty body if json content-type is set.
  const headers = (hasBody: boolean): Record<string, string> => ({
    ...(hasBody ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  const req = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers(init?.body != null), ...(init?.headers as any) } });
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) throw new Error(typeof body === "object" ? body?.error?.message ?? JSON.stringify(body) : String(body));
    return body;
  };
  return {
    ok: Boolean(base),
    get: (p: string) => req(p),
    post: (p: string, body?: unknown) => req(p, { method: "POST", body: JSON.stringify(body ?? {}) }),
    patch: (p: string, body?: unknown) => req(p, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
    del: (p: string) => req(p, { method: "DELETE" }),
  };
}
export type Api = ReturnType<typeof makeApi>;
