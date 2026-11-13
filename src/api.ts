export interface Conn { keySet: boolean; model: string; fallbackModel: string; baseUrl: string }
export interface CheckResult { ok: boolean; error?: string; models?: string[]; modelFound?: boolean | null }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
export const getConn = () => call<Conn>("/api/settings");
export const saveConn = (patch: { key?: string | null; model?: string; fallbackModel?: string; baseUrl?: string }) =>
  call<Conn>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
export const checkConn = () => call<CheckResult>("/api/check", { method: "POST", body: "{}" });
