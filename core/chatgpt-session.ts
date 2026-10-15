/** The Core requests credentials over its parent IPC; public state contains no tokens. */
import { randomUUID } from 'node:crypto';
import type { ChatGPTSession, ChatGPTStatus } from 'cortico-provider-coo/src/chatgpt/types.ts';

export function createChatGPTSession(onState: (state: ChatGPTStatus) => void): ChatGPTSession {
  let status: ChatGPTStatus = { connected: false, sharing: false, pending: false, email: null, account: null, error: null };
  let connection = new AbortController();
  const update = (next: ChatGPTStatus) => {
    if (!next.sharing) connection.abort(new Error('ChatGPT 連線已停止。'));
    else if (connection.signal.aborted) connection = new AbortController();
    status = next; onState(status);
  };
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  process.on('message', (raw) => {
    const message = raw as { type?: string; id?: string; state?: ChatGPTStatus; result?: unknown; error?: string };
    if (message.type === 'personal:chatgpt-state' && message.state) update(message.state);
    if (message.type === 'personal:chatgpt-result' && message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
    }
  });
  process.on('disconnect', () => {
    connection.abort(new Error('ChatGPT 登入服務已中斷。'));
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('ChatGPT 登入服務已中斷。')); }
    pending.clear();
  });
  const call = <T>(method: string): Promise<T> => new Promise((resolve, reject) => {
    if (!process.send || !process.connected) { reject(new Error('ChatGPT 登入需要由 Coopanion Personal 主程式啟動。')); return; }
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('ChatGPT 登入服務回應逾時。')); }, 120_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    process.send({ type: 'personal:chatgpt-request', id, method }, (error) => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('ChatGPT 登入服務已中斷。')); }
    });
  });
  return { status: () => status,
    async action(method) { const result = await call<ChatGPTStatus>(method); if (method !== 'usage') update(result); return result; },
    token: (force = false) => call(force ? 'refresh' : 'token'),
    signal: () => connection.signal,
  };
}
