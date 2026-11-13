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

export interface ChatInfo { id: number; title: string; createdAt: string; count: number }
export interface Msg { id: number; role: "user" | "assistant"; content: string; at: string }
export interface GraphData { chats: { id: number; title: string; count: number }[]; messages: { id: number; chatId: number; role: "user" | "assistant"; preview: string; size: number; at: string }[]; links: { a: number; b: number; w: number; words: string[] }[] }

export const listChats = () => call<ChatInfo[]>("/api/chats");
export const createChat = () => call<{ id: number }>("/api/chats", { method: "POST", body: "{}" });
export const getMessages = (id: number) => call<Msg[]>(`/api/chats/${id}`);
export const deleteChat = (id: number) => call<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" });
export const getGraph = () => call<GraphData>("/api/graph");

export type StreamEvent = { user?: number; delta?: string; assistant?: number; done?: boolean; error?: string };
/** Отправляет сообщение и отдаёт события ответа по мере прихода. Отмена через signal. */
export async function sendMessage(id: number, text: string, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  const r = await fetch(`/api/chats/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal });
  if (!r.ok || !r.body) { const d = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(d.error ?? `HTTP ${r.status}`); }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line) as StreamEvent); } catch { /* пропускаем битую строку */ } }
    }
  }
}
