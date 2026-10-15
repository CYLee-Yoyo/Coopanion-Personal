/**
 * Connecting a service through a Cortico console's provider routes, as the app's guide and its
 * Start page do: each service gets its own endpoint for each of its platforms (`endpointName`), so
 * switching back and forth keeps each key. A ChatGPT plan is signed in instead (`connectChatGPT`),
 * through the `chatgpt` module's console methods. `call` is the caller's way to reach the console (fetch in the Core, the
 * console's own api in the browser); nothing here imports Node or the DOM.
 */
import { CHATGPT, CHATGPT_MODULE, chatgptEntry, connectionVendor, endpointName, vendorEntry, type Region, type Vendor } from './vendors.ts';
import type { ChatGPTStatus } from './chatgpt/types.ts';

/** GET when `body` is left out, POST otherwise; throws on an error status. */
export type ConsoleCall = <T>(path: string, body?: unknown) => Promise<T>;

export interface Connection {
  /** The active endpoint has its model and key and its module is available. */
  ready: boolean;
  /** Which service the active endpoint is, when it is one of these. */
  vendor: Vendor | null;
  /** Which of the service's platforms; null for a service with one platform. */
  region: Region | null;
  model: string;
}

export interface ConnectResult { ok: boolean; why: string | null; ms: number | null }

interface Status { modelConnection?: { ready: boolean; model: string | null; module?: string; baseUrl?: string } | null }
interface Detail { name: string; entry: Record<string, unknown>; revision: string }
interface TestReply { ok?: boolean; elapsedMs?: number; error?: string; status?: number; hint?: string }

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function currentConnection(call: ConsoleCall): Promise<Connection> {
  const mc = (await call<Status>('/api/status').catch(() => null))?.modelConnection;
  const at = mc ? connectionVendor(mc) : null;
  return { ready: !!mc?.ready, vendor: at?.vendor ?? null, region: at?.region ?? null, model: mc?.model ?? '' };
}

/** Tests the endpoint `name` as it is saved. */
export async function testEndpoint(call: ConsoleCall, name: string): Promise<ConnectResult> {
  try {
    const r = await call<TestReply>(`/api/providers/${encodeURIComponent(name)}/test`, {});
    const ok = r?.ok !== false && !r?.error;
    return { ok, ms: typeof r?.elapsedMs === 'number' ? Math.round(r.elapsedMs) : null, why: ok ? null : r?.hint ?? r?.error ?? `HTTP ${r?.status ?? '?'}` };
  } catch (err) {
    return { ok: false, ms: null, why: errText(err) };
  }
}

/**
 * Saves `key` and `model` for `vendor` on `region` (creating its endpoint the first time), tests it,
 * and once the test passes makes it the active endpoint and resumes the run, which starts paused
 * without a key. An empty `key` keeps the one the endpoint has; a new endpoint needs one. An empty
 * `model` keeps the endpoint's model, or takes the service's default for a new endpoint. `region`
 * matters only for a service with a platform per region.
 */
export async function connectVendor(call: ConsoleCall, vendor: Vendor, key: string, model = '', region: Region = 'cn'): Promise<ConnectResult> {
  const secretValue = key.trim() || undefined;
  const typed = model.trim();
  const name = endpointName(vendor, region);
  try {
    const list = await call<{ providers: Array<{ name: string }> }>('/api/providers');
    if (list.providers.some((p) => p.name === name)) {
      const d = await call<Detail>(`/api/providers/${encodeURIComponent(name)}`);
      const entry = { ...d.entry };
      if (typed) {
        entry.spec = { ...(d.entry.spec as Record<string, unknown> | undefined), model: typed };
        entry.multimodal = (vendor.vision ?? []).includes(typed);
      }
      await call(`/api/providers/${encodeURIComponent(name)}/save`, { name: d.name, entry, expectedRevision: d.revision, secretValue });
    } else {
      await call('/api/providers', { name, entry: vendorEntry(vendor, typed || vendor.model, region), secretValue });
    }
  } catch (err) {
    return { ok: false, ms: null, why: errText(err) };
  }
  return testAndStart(call, name);
}

/** Tests the endpoint `name` and, once the test passes, makes it the active endpoint and resumes the run. */
async function testAndStart(call: ConsoleCall, name: string): Promise<ConnectResult> {
  const r = await testEndpoint(call, name);
  if (!r.ok) return r;
  try {
    await call(`/api/providers/${encodeURIComponent(name)}/activate`, {});
    await call('/api/run/resume', {});
  } catch (err) {
    return { ok: false, ms: r.ms, why: errText(err) };
  }
  return r;
}

/** Public account state for the guide and advanced editor. Credentials remain in Electron main. */
export interface SignInState {
  signedIn: boolean;
  email: string | null;
  phase: 'idle' | 'waiting' | 'done' | 'failed';
  reason: string | null;
  /** The plan's models, once a sign-in is done. */
  models?: string[];
}

/** The console panel of the personal subscription provider. */
export const SIGN_IN_PANEL = 'auth';

/** The console route of a sign-in method of the `chatgpt` module. */
const signInRoute = (method: string) => `/api/console/providers/${encodeURIComponent(`llm:${CHATGPT_MODULE}`)}/panels/${SIGN_IN_PANEL}/${method}`;

const signInState = (state: ChatGPTStatus): SignInState => ({
  signedIn: state.sharing,
  email: state.email,
  phase: state.pending ? 'waiting' : state.error ? 'failed' : state.sharing ? 'done' : 'idle',
  reason: state.error,
});

export const chatgptState = async (call: ConsoleCall, _name: string): Promise<SignInState> =>
  signInState(await call<ChatGPTStatus>(signInRoute('state'), { args: [] }));

/** Revokes and removes the tokens of the ChatGPT endpoint `name`. */
export const signOutChatGPT = async (call: ConsoleCall, _name: string): Promise<SignInState> =>
  signInState(await call<ChatGPTStatus>(signInRoute('signout'), { args: [] }));

/** How often a sign-in under way is looked at. */
const SIGN_IN_POLL_MS = 1000;

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((done, fail) => {
  if (signal?.aborted) return fail(new Error('cancelled'));
  const abort = () => { clearTimeout(timer); fail(new Error('cancelled')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); done(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

interface SignInOptions { signal?: AbortSignal; pollMs?: number }

/**
 * Electron main opens the authorization page and owns the callback. The caller polls public state;
 * leaving the caller stops that wait without exporting an authorization URL or credentials.
 */
export async function signInChatGPT(call: ConsoleCall, name: string, _open: (url: string) => void, opts: SignInOptions = {}): Promise<SignInState> {
  await call(signInRoute('signin'), { args: [] });
  let state: SignInState;
  do {
    await wait(opts.pollMs ?? SIGN_IN_POLL_MS, opts.signal);
    state = await chatgptState(call, name);
  } while (state.phase === 'waiting');
  return state;
}

/**
 * Connects the personal subscription endpoint using the account's catalog. A saved available model
 * is retained; a new endpoint takes the first available model. Only a successful test starts the run.
 */
export async function connectChatGPT(call: ConsoleCall, open: (url: string) => void, opts: SignInOptions & { name?: string } = {}): Promise<ConnectResult> {
  const name = opts.name ?? endpointName(CHATGPT, 'cn');
  if (name !== CHATGPT_MODULE) return { ok: false, ms: null, why: 'Unknown personal subscription endpoint' };
  try {
    const list = await call<{ providers: Array<{ name: string }> }>('/api/providers');
    if (!list.providers.some((p) => p.name === name)) await call('/api/providers', { name, entry: chatgptEntry() });
    const state = await signInChatGPT(call, name, open, opts);
    if (state.phase !== 'done' || !state.signedIn) return { ok: false, ms: null, why: state.reason ?? state.phase };
    const models = await call<Array<{ id: string }>>(signInRoute('models'), { args: [] });
    if (!models.length) return { ok: false, ms: null, why: 'No subscription models available' };
    const d = await call<Detail>(`/api/providers/${encodeURIComponent(name)}`);
    const selected = String((d.entry.spec as Record<string, unknown> | undefined)?.model ?? '');
    const model = models.find(row => row.id === selected)?.id ?? models[0]!.id;
    await call(signInRoute('select'), { args: [model] });
  } catch (err) {
    return { ok: false, ms: null, why: errText(err) };
  }
  return testAndStart(call, name);
}
