export interface Conn { keySet: boolean; model: string; fallbackModel: string; memory: boolean; embedModel?: string; baseUrl: string }
export interface Explained { error?: string; hint?: string; code?: number | string; detail?: string }
export interface CheckResult extends Explained { ok: boolean; models?: string[]; modelFound?: boolean | null; fallbackFound?: boolean | null }
export interface TestResult extends Explained { ok: boolean; model?: string; ms?: number; text?: string }
export interface GuideItem { code: number | string; title: string; hint: string }
export interface Guide { http: GuideItem[]; net: GuideItem[]; other: GuideItem[] }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
export const getConn = () => call<Conn>("/api/settings");
export const saveConn = (patch: { key?: string | null; model?: string; fallbackModel?: string; memory?: boolean; embedModel?: string; baseUrl?: string }) =>
  call<Conn>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
export const testModel = (model: string) => call<TestResult>("/api/test-model", { method: "POST", body: JSON.stringify({ model }) });
export const getGuide = () => call<Guide>("/api/errors-guide");
export const checkConn = () => call<CheckResult>("/api/check", { method: "POST", body: "{}" });

export interface ChatInfo { id: number; title: string; createdAt: string; count: number }
export interface Msg { id: number; role: "user" | "assistant"; content: string; at: string }
export interface BrainStats { memories: number; topics: number; links: number; level: number; levelName: string; next: number | null }
export interface GraphData {
  mode?: "memory"; stats?: BrainStats; chats: { id: number; title: string; count: number; hidden?: number; summary?: string }[];
  messages: { id: number; chatId: number; role: "user" | "assistant"; preview: string; size: number; at: string; tier?: string; pinned?: boolean; past?: boolean; hits?: number; src?: number; topics?: string[] }[];
  links: { a: number; b: number; w: number; words: string[]; kinds?: string[] }[];
}
export interface MemoryItem { id: number; text: string; topics: string[]; hits: number; at: string }
export interface MemoryList { memory: boolean; total: number; items: MemoryItem[] }
export interface ScanResult extends Explained { ok: boolean; added?: number; strengthened?: number; empty?: boolean }

export const listChats = () => call<ChatInfo[]>("/api/chats");
export const createChat = () => call<{ id: number }>("/api/chats", { method: "POST", body: "{}" });
export const getMessages = (id: number) => call<Msg[]>(`/api/chats/${id}`);
export const deleteChat = (id: number) => call<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" });
export const getGraph = () => call<GraphData>("/api/graph");
export const getBrain = (open: string[] = []) => call<GraphData>("/api/brain" + (open.length ? "?open=" + encodeURIComponent(open.join(",")) : ""));
export const getMemories = () => call<MemoryList>("/api/memories");
export const forgetMemory = (id: number) => call<{ ok: true }>(`/api/memories/${id}`, { method: "DELETE" });
export const forgetAll = () => call<{ ok: true }>("/api/memories", { method: "DELETE" });
export const updateMemory = (id: number, patch: { text?: string; topics?: string[] | string; pinned?: boolean }) => call<{ ok?: boolean; error?: string }>(`/api/memories/${id}`, { method: "PUT", body: JSON.stringify(patch) });
export const exportAll = () => call<Record<string, unknown>>("/api/export");
export const importAll = (data: unknown) => call<{ ok?: boolean; chats?: number; messages?: number; memories?: number; error?: string }>("/api/import", { method: "POST", body: JSON.stringify(data) });
export interface Review { merges: { keep: number; items: { id: number; text: string; hits: number; pinned: boolean }[] }[]; conflicts: { a: { id: number; text: string }; b: { id: number; text: string }; why: string }[]; conflictsError: string | null; compress?: { topic: string; ids: number[]; items: string[]; summary: string }[] }
export const reviewMemories = () => call<Review>("/api/memories/review", { method: "POST", body: "{}" });
export const mergeMemories = (keep: number, drop: number[], history = false) => call<{ ok?: boolean; error?: string }>("/api/memories/merge", { method: "POST", body: JSON.stringify({ keep, drop, history }) });
export interface Inactive { id: number; text: string; state: "archived" | "replaced"; topics: string[]; at: string; replacedBy: number | null; replacedText: string | null }
export interface Entity { id: number; name: string; memories: number[]; relations: { s: string; r: string; o: string; past: boolean }[] }
export const getEntities = () => call<{ items: Entity[] }>("/api/entities");
export const getInactive = () => call<{ items: Inactive[] }>("/api/memories/inactive");
export const restoreMemory = (id: number) => call<{ ok?: boolean; error?: string }>(`/api/memories/${id}/restore`, { method: "POST", body: "{}" });
export const compressMemories = (ids: number[], text: string, topic: string) => call<{ ok?: boolean; error?: string }>("/api/memories/compress", { method: "POST", body: JSON.stringify({ ids, text, topic }) });
export interface VecInfo { total: number; indexed: number; model: string; ok: boolean | null; error: string; done?: number }
export const getVectors = () => call<VecInfo>("/api/vectors");
export const buildVectors = () => call<VecInfo & Explained>("/api/vectors/build", { method: "POST", body: "{}" });
export const scanMemories = () => call<ScanResult>("/api/memories/scan", { method: "POST", body: "{}" });

export type StreamEvent = Explained & { user?: number; delta?: string; assistant?: number; done?: boolean; notice?: string; recalled?: { id: number; text: string; hop?: boolean; session?: boolean; past?: boolean }[]; brain?: { added?: number; strengthened?: number; addedIds?: number[]; strengthenedIds?: number[]; error?: Explained } };
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
export interface SleepInfo { at: string; merged: number; compressed: number; archived: number; backup: string }
export const getSleep = () => call<{ last: SleepInfo | null; sleeping: boolean }>("/api/sleep");
export const runSleep = () => call<SleepInfo>("/api/sleep", { method: "POST", body: "{}" });
export const confirmMemory = (id: number) => call<{ ok: true }>(`/api/memories/${id}/confirm`, { method: "POST", body: "{}" });
export const correctMemory = (id: number, text: string) => call<{ ok?: boolean; error?: string }>(`/api/memories/${id}/correct`, { method: "POST", body: JSON.stringify({ text }) });
