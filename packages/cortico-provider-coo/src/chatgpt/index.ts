/** The ChatGPT plan is a separate provider; credentials come only from the parent session capability. */
import type { ProviderModule } from 'cortico/providers/base.ts';
import type { ModelSpec } from 'cortico/core/types.ts';
import { ChatGPTClient, listChatGPTModels } from './client.ts';
import { CHATGPT_BASE_URL, CHATGPT_ENDPOINT, CHATGPT_KIND, type ChatGPTSession } from './types.ts';

export function createChatGPTModule(session: ChatGPTSession, onUnavailable: () => void): ProviderModule {
  let blocked: string | null = null;
  let account: string | null = null;
  const currentBlock = () => {
    if (account !== session.status().account) { account = session.status().account; blocked = null; }
    return blocked;
  };
  return {
    id: CHATGPT_KIND, title: 'ChatGPT 訂閱', defaultBaseUrl: CHATGPT_BASE_URL,
    description: '使用 ChatGPT 訂閱額度；不會自動切換付費 API。',
    reasoningTiers: [], effortSuggestions: ['low', 'medium', 'high'], serviceTiers: [],
    normalize: entry => ({ ...entry, baseUrl: CHATGPT_BASE_URL, secret: undefined, pricing: [], serviceTier: undefined }),
    validateEntry: entry => { if (entry.secret || (entry.baseUrl && entry.baseUrl !== CHATGPT_BASE_URL)) throw new Error('ChatGPT 訂閱連線不接受 API Key 或其他服務位址。'); },
    availability: () => ({ ready: session.status().sharing && !currentBlock(), reason: currentBlock() ?? session.status().error ?? '請先登入 ChatGPT 並授權使用訂閱額度。' }),
    accepts: (entry, _spec, mime) => entry.multimodal === true && mime.startsWith('image/'),
    prices: () => [],
    console: host => ({
      panels: [{ id: 'auth', title: 'ChatGPT 訂閱連線', builtin: 'connection-protocol' }],
      invoke: async (panel, method, args) => {
        if (panel !== 'auth') throw new Error('Unknown ChatGPT panel');
        if (method === 'state') return { ...session.status(), blocked: currentBlock(),
          selectedModel: host.entries().find(row => row.name === CHATGPT_ENDPOINT)?.entry.spec?.model ?? null };
        if (method === 'models') return listChatGPTModels(session);
        if (method === 'signin' || method === 'signout' || method === 'cancel' || method === 'usage') {
          if (method === 'signout') onUnavailable();
          const state = await session.action(method);
          if (method === 'signout') blocked = null;
          return state;
        }
        if (method === 'select') {
          const [model] = args;
          if (typeof model !== 'string' || !(await listChatGPTModels(session)).some(row => row.id === model)) throw new Error('請選擇目前帳號可用的 ChatGPT 模型。');
          blocked = null;
          const entry = host.entries().find(row => row.name === CHATGPT_ENDPOINT)?.entry;
          host.save(CHATGPT_ENDPOINT, { kind: CHATGPT_KIND, baseUrl: CHATGPT_BASE_URL, pricing: [], multimodal: true,
            spec: { ...entry?.spec, model, thinking: true, reasoningEffort: 'low' } as ModelSpec });
          return { ok: true };
        }
        throw new Error('Unknown ChatGPT operation');
      },
    }),
    create: (name, entry, host) => ({
      compatibilityKey: () => [CHATGPT_KIND, name, session.status().account],
      listModels: () => listChatGPTModels(session),
      client: new ChatGPTClient(session, { enabled: () => (host.currentEntry?.() ?? entry).multimodal === true, read: host.readBlob }, message => {
        account = session.status().account; blocked = message; onUnavailable();
      }),
    }),
  };
}
