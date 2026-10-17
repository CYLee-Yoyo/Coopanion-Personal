/** Subscription-only Responses transport. No API key, paid-provider fallback, or automatic generation retry. */
import { randomUUID } from 'node:crypto';
import { BaseProvider, type ListedModel } from 'cortico/providers/base.ts';
import { buildResponsesBody, type ResponsesProviderOptions } from 'cortico/providers/openai-responses-compat/native.ts';
import { NativeResponseAssembly } from 'cortico/providers/transport/response-assembly.ts';
import { EventDecoder, requestJson } from 'cortico/providers/transport/response-http.ts';
import { GenerationError, unknownMeters, type GenerateOptions, type Generation, type ProviderAttempt } from 'cortico/core/generation.ts';
import type { OutputItem, Request, StreamEvent } from 'cortico/protocol/open-responses/index.ts';
import { ResponseProtocolError } from 'cortico/protocol/open-responses/stream.ts';
import type { ChatGPTSession } from './types.ts';
import { CHATGPT_BASE_URL } from './types.ts';
import { sinceLastDelivery } from '../context.ts';

const NAMESPACE = 'coo';
export type ChatGPTFailure = 'usage-limit' | 'authorization' | 'permission' | 'ineligible' | 'unavailable' | 'unsupported' | 'network' | 'timeout' | 'response' | 'unknown';
export class ChatGPTError extends GenerationError {
  constructor(readonly reason: ChatGPTFailure, ...args: ConstructorParameters<typeof GenerationError>) { super(...args); }
}
function failureReason(code: string, status: number): ChatGPTFailure {
  if (code === 'subscription_sharing_usage_limit_exceeded') return 'usage-limit';
  if (code === 'subscription_sharing_invalid_user' || status === 401) return 'authorization';
  if (code === 'subscription_sharing_user_not_eligible') return 'ineligible';
  if (code === 'subscription_sharing_unsupported_capability' || code === 'subscription_sharing_route_not_supported') return 'unsupported';
  if (code === 'chatpass_v2_scope_not_authorized' || code === 'chatpass_v2_invalid_authorization_context' || status === 403) return 'permission';
  if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable' || status === 429 || status >= 500) return 'unavailable';
  return 'unknown';
}
const OMIT = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt',
  'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id', 'service_tier'];
const PROTOCOL_FAILURES = new Map([
  ['Unknown Open Responses event type', 'event_type'],
  ['Non-increasing event sequence', 'event_sequence'],
  ['Invalid native Responses resource', 'response_resource'],
  ['Event before response.created', 'response_created'],
  ['Terminal response changed a closed item', 'terminal_item'],
  ['Final content part disagrees with deltas', 'content_part'],
  ['Final content disagrees with deltas', 'content'],
  ['Final summary disagrees with deltas', 'summary'],
  ['Final text disagrees with deltas', 'text'],
  ['Terminal response contains unannounced output items', 'terminal_outputs'],
  ['Final function arguments disagree with deltas', 'function_arguments'],
  ['Final function identity changed', 'function_identity'],
]);

export function subscriptionMessage(code: string): string {
  if (code === 'subscription_sharing_usage_limit_exceeded') return 'ChatGPT 訂閱額度或此應用程式的用量上限已達限制。已停止請求，請查看 ChatGPT 用量設定。';
  if (code === 'subscription_sharing_user_not_eligible') return '此帳號或工作區目前無法使用 ChatGPT 訂閱連線。';
  if (code === 'subscription_sharing_unsupported_capability') return '此模型或請求功能不支援 ChatGPT 訂閱連線。';
  if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') return 'ChatGPT 暫時無法確認訂閱用量，請稍後重試。';
  if (code === 'subscription_sharing_invalid_user' || code.startsWith('chatpass_v2_')) return 'ChatGPT 授權無法使用，請重新登入並確認訂閱授權。';
  return `ChatGPT 訂閱請求未完成（${code}）。`;
}

export function subscriptionBody(request: Request, options: GenerateOptions, media: ResponsesProviderOptions['media']): Record<string, unknown> {
  const body = buildResponsesBody(request, options.context ? { ...options, context: sinceLastDelivery(options.context) } : options,
    { media, reasoningReplay: 'encrypted' });
  for (const key of OMIT) delete body[key];
  body.store = false;
  body.stream = true;
  const tools = request.tools ?? [];
  if (tools.some(tool => tool.type !== 'function')) throw new Error('ChatGPT 訂閱連線目前只提供本機 function tools。');
  body.tools = tools.length ? [{ type: 'namespace', name: NAMESPACE, description: 'Local desktop companion tools.',
    tools: tools.map(tool => ({ ...tool, strict: false })) }] : [];
  body.input = (body.input as Record<string, unknown>[]).map(item => item.type === 'function_call' ? { ...item, namespace: NAMESPACE } : item);
  if (typeof body.tool_choice === 'object' && body.tool_choice !== null && (body.tool_choice as { type?: string }).type === 'function')
    body.tool_choice = { ...body.tool_choice, namespace: NAMESPACE };
  return body;
}

/** Normalize the wire namespace consistently in delta items and the terminal response. */
export function subscriptionEvent(raw: unknown): StreamEvent {
  const event = structuredClone(raw) as Record<string, any>;
  const normalize = (item: Record<string, any>) => {
    if (item.type !== 'function_call') return item;
    if (item.namespace != null && item.namespace !== NAMESPACE) throw new Error('ChatGPT 回傳未知的工具 namespace。');
    if (typeof item.name === 'string' && item.name.startsWith(`${NAMESPACE}.`)) item.name = item.name.slice(NAMESPACE.length + 1);
    delete item.namespace;
    return item;
  };
  if (event.item) event.item = normalize(event.item);
  if (event.response?.output) event.response.output = event.response.output.map(normalize);
  return event as StreamEvent;
}

function errorCode(raw: unknown, fallback: string): string {
  const error = raw as { error?: { code?: unknown }; code?: unknown };
  const code = error?.error?.code ?? error?.code;
  return typeof code === 'string' && /^(subscription_sharing_|chatpass_v2_)[a-z_]{1,80}$/.test(code) ? code : fallback;
}

function bearerHeader(token: string): string {
  if (typeof token !== 'string' || token.length > 16_384 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(token)) throw new Error('ChatGPT 憑證格式不符，請重新登入。');
  return `Bearer ${token}`;
}

/** Subscription terminal receipts may omit output already delivered through output_item.done. */
class ChatGPTResponseAssembly extends NativeResponseAssembly {
  private announced = new Set<number>();
  private finished = new Map<number, OutputItem>();

  override feed(payload: unknown, emit: (event: StreamEvent) => void): void {
    let event = payload as StreamEvent;
    if (event?.type === 'response.completed' && event.response.status === 'completed' && event.response.output.length === 0
      && this.announced.size > 0 && this.finished.size === this.announced.size) {
      const rows = [...this.finished.entries()].sort(([a], [b]) => a - b);
      if (rows.every(([index], ordinal) => index === ordinal))
        event = { ...event, response: { ...event.response, output: rows.map(([, item]) => item) } };
    }
    const done = event?.type === 'response.output_item.done' ? structuredClone(event.item) : null;
    super.feed(event, emit);
    if (event.type === 'response.output_item.added') this.announced.add(event.output_index);
    if (event.type === 'response.output_item.done') this.finished.set(event.output_index, done!);
  }
}

export async function listChatGPTModels(session: ChatGPTSession, fetchImpl: typeof fetch = fetch): Promise<ListedModel[]> {
  const token = await session.token();
  const signals = [session.signal?.(), AbortSignal.timeout(20_000)].filter((signal): signal is AbortSignal => Boolean(signal));
  const response = await fetchImpl(`${CHATGPT_BASE_URL}/models`, { headers: { Authorization: bearerHeader(token.accessToken) }, redirect: 'error', signal: AbortSignal.any(signals) });
  if (!response.ok) throw new Error(`無法取得 ChatGPT 訂閱模型（${response.status}）。`);
  let data: { models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown; context_window?: unknown; input_modalities?: unknown }> };
  try { data = await response.json() as typeof data; } catch { throw new Error('ChatGPT 訂閱模型清單格式不符。'); }
  if (!Array.isArray(data.models)) throw new Error('ChatGPT 訂閱模型清單格式不符。');
  return data.models.filter(row => row.visibility === 'list' && typeof row.slug === 'string').map(row => ({ id: row.slug as string,
    displayName: typeof row.display_name === 'string' ? row.display_name : row.slug as string,
    ...(typeof row.context_window === 'number' && row.context_window > 0 ? { contextWindow: row.context_window } : {}),
    ...(Array.isArray(row.input_modalities) ? { inputImages: row.input_modalities.includes('image') } : {}),
  }));
}

export class ChatGPTClient extends BaseProvider {
  constructor(private readonly session: ChatGPTSession, private readonly media: ResponsesProviderOptions['media'],
    private readonly onBlocked: (message: string, reason: ChatGPTFailure) => void, private readonly fetchImpl: typeof fetch = fetch) { super(); }

  async respond(request: Request, options: GenerateOptions = {}): Promise<Generation> {
    const origin = options.origin ?? { instance: 'chatgpt-plan', module: 'chatgpt-plan', model: request.model ?? '', compatibilityDomain: 'chatgpt-plan' };
    const attempts: ProviderAttempt[] = [];
    const generationId = randomUUID();
    const body = subscriptionBody(request, options, this.media);
    const assembly = new ChatGPTResponseAssembly();
    const started = Date.now();
    const attempt: ProviderAttempt = { id: randomUUID(), generationId, ordinal: 0, origin, startedAt: new Date().toISOString(), elapsedMs: 0,
      requestId: null, responseId: null, outcome: 'failed', status: null, serviceTier: null, purpose: options.diagnostic ? 'diagnostic' : 'generation', meters: unknownMeters(), charges: [] };
    const timeout = new AbortController();
    const signals = [options.signal, this.session.signal?.(), timeout.signal].filter((signal): signal is AbortSignal => Boolean(signal));
    const signal = AbortSignal.any(signals);
    let timer = setTimeout(() => timeout.abort(new Error('ChatGPT 回應逾時。')), 300_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let phase = 'authentication';
    try {
      signal.throwIfAborted();
      const token = await this.session.token();
      signal.throwIfAborted();
      phase = 'request';
      const response = await this.fetchImpl(`${CHATGPT_BASE_URL}/responses`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: bearerHeader(token.accessToken) },
        body: requestJson(body), redirect: 'error', signal });
      attempt.status = response.status;
      attempt.requestId = response.headers.get('x-request-id');
      if (!response.ok) {
        let raw: unknown = null;
        try { raw = await response.json(); } catch { /* Do not record upstream HTML or credentials. */ }
        const code = errorCode(raw, `http_${response.status}`);
        const reason = failureReason(code, response.status);
        throw new ChatGPTError(reason, subscriptionMessage(code), attempts, null, origin, response.status, JSON.stringify({ error: { code } }));
      }
      if (!response.body) throw new Error('ChatGPT 未回傳串流內容。');
      phase = 'stream';
      reader = response.body.getReader();
      const frames = new EventDecoder();
      const decoder = new TextDecoder();
      let terminal = false;
      read: for (;;) {
        const chunk = await reader.read();
        clearTimeout(timer);
        timer = setTimeout(() => timeout.abort(new Error('ChatGPT 串流回應逾時。')), 120_000);
        if (chunk.done) break;
        for (const payload of frames.feed(decoder.decode(chunk.value, { stream: true }))) {
          if (payload === '[DONE]') break read;
          let raw: Record<string, any>;
          try { raw = JSON.parse(payload); } catch { throw new Error('ChatGPT 串流格式不符，未記錄回應原文。'); }
          // Transport metadata does not contribute output or complete an inference.
          if (raw.type === 'response.metadata') continue;
          if (raw.type === 'response.failed' || raw.type === 'error') {
            const code = errorCode(raw.response ?? raw, 'response_failed');
            const reason = failureReason(code, response.status);
            throw new ChatGPTError(reason, subscriptionMessage(code), attempts, assembly.snapshot(), origin, response.status, JSON.stringify({ error: { code } }));
          }
          if (raw.type === 'response.incomplete') {
            const reason = raw.response?.incomplete_details?.reason;
            const detail = reason === 'max_output_tokens' || reason === 'content_filter' ? `（${reason}）` : '';
            throw new ChatGPTError('response', `ChatGPT 回覆未完成${detail}，未執行工具。`, attempts, assembly.snapshot(), origin, response.status);
          }
          const event = subscriptionEvent(raw);
          assembly.feed(event, event => options.onEvent?.(event));
          if (event.type === 'response.completed' || event.type === 'response.incomplete') { terminal = true; break read; }
        }
      }
      if (!terminal) throw new Error('ChatGPT 串流中斷，未收到完整回覆。');
      phase = 'completion';
      const result = assembly.finish();
      attempt.responseId = result.id;
      attempt.outcome = result.status === 'completed' ? 'completed' : 'incomplete';
      if (result.status !== 'completed') {
        const reason = result.incomplete_details?.reason;
        const detail = reason === 'max_output_tokens' || reason === 'content_filter' ? `（${reason}）` : '';
        throw new ChatGPTError('response', `ChatGPT 回覆未完成${detail}，未執行工具。`, attempts, result, origin, response.status);
      }
      return { response: result, origin, attempts };
    } catch (error) {
      attempt.outcome = options.signal?.aborted ? 'aborted' : attempt.outcome;
      const message = error instanceof ResponseProtocolError ? `ChatGPT 回應格式不符（${PROTOCOL_FAILURES.get(error.message) ?? 'response_protocol'}）。`
        : error instanceof Error && error.message.startsWith('ChatGPT ') ? error.message : `ChatGPT 訂閱連線失敗（${phase}），未記錄原始錯誤內容。`;
      const reason = timeout.signal.aborted || (error instanceof Error && error.name === 'TimeoutError') ? 'timeout'
        : phase === 'authentication' ? 'authorization' : phase === 'request' && attempt.status === null ? 'network' : 'response';
      const failure = error instanceof ChatGPTError ? error : new ChatGPTError(reason, message, attempts, assembly.snapshot(), origin, attempt.status ?? 0);
      if (!options.signal?.aborted && !this.session.signal?.()?.aborted) this.onBlocked(failure.message, failure.reason);
      throw failure;
    } finally {
      clearTimeout(timer);
      attempt.elapsedMs = Date.now() - started;
      attempt.meters = assembly.meters();
      attempt.serviceTier = assembly.serviceTier();
      if (reader) { try { await reader.cancel(); } catch { /* Already closed. */ } reader.releaseLock(); }
      attempts.push(attempt);
    }
  }
}
