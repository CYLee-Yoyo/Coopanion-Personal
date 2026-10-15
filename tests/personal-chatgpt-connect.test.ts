import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { ProviderRegistry } from 'cortico/providers/registry.ts';
import { ProviderSettings } from 'cortico/providers/console/settings.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { CORE_DEFAULTS } from 'cortico/core/config.ts';
import type { CoreConfig } from 'cortico/core/types.ts';
import { createChatGPTModule } from '../packages/cortico-provider-coo/src/chatgpt/index.ts';
import { CHATGPT_BASE_URL, CHATGPT_ENDPOINT, CHATGPT_KIND, type ChatGPTSession, type ChatGPTStatus } from '../packages/cortico-provider-coo/src/chatgpt/types.ts';
import { chatgptState, connectChatGPT, signOutChatGPT, type ConsoleCall } from '../packages/cortico-provider-coo/src/connect.ts';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });

function fixture(testOk = true, sharing = false) {
  const dir = mkdtempSync(join(tmpdir(), 'personal-connect-'));
  const inside = relative(tmpdir(), dir);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Fixture outside temporary storage');
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  let state: ChatGPTStatus = { connected: sharing, sharing, pending: false, account: sharing ? 'fixture-account' : null, email: null, error: null };
  let paused = true;
  const session: ChatGPTSession = {
    status: () => state,
    token: async () => {
      if (!state.sharing) throw new Error('Fixture is not authorized');
      return { accessToken: 'fixture-private-token', account: state.account };
    },
    action: async method => {
      if (method === 'signin') {
        state = { ...state, pending: true };
        queueMicrotask(() => { state = { ...state, connected: true, sharing: true, pending: false, account: 'fixture-account' }; });
      } else if (method === 'signout') state = { ...state, connected: false, sharing: false, account: null };
      return state;
    },
  };
  const cfg: CoreConfig = { ...structuredClone(CORE_DEFAULTS), displayName: 'Fixture', providers: { [CHATGPT_ENDPOINT]: { kind: CHATGPT_KIND, baseUrl: CHATGPT_BASE_URL, spec: { model: 'fixture-second', thinking: true } } }, activeProvider: CHATGPT_ENDPOINT };
  const module = createChatGPTModule(session, () => { paused = true; });
  const providers = join(dir, 'providers');
  const registry = new ProviderRegistry(() => cfg.providers, { stateRoot: providers, readBlob: () => null, keepThinking: () => true, log: nullLogger() }, [module]);
  const settings = new ProviderSettings(cfg, registry, join(dir, 'config.json'), providers, [module]);
  const contribution = settings.sources().find(source => source.id === `llm:${CHATGPT_KIND}`)!.contribute('en');
  vi.stubGlobal('fetch', async (url: unknown) => {
    if (String(url) !== `${CHATGPT_BASE_URL}/models`) throw new Error('Unexpected network request');
    return new Response(JSON.stringify({ models: [{ slug: 'fixture-first', visibility: 'list' }, { slug: 'fixture-second', visibility: 'list' }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const call: ConsoleCall = async <T>(path: string, body?: unknown): Promise<T> => {
    if (path.includes('/panels/auth/')) return contribution.invoke!('auth', path.split('/').at(-1)!, (body as { args: unknown[] }).args) as Promise<T>;
    if (path === '/api/providers') return { providers: Object.keys(cfg.providers).map(name => ({ name })) } as T;
    if (path === `/api/providers/${CHATGPT_ENDPOINT}`) return { name: CHATGPT_ENDPOINT, entry: cfg.providers[CHATGPT_ENDPOINT] } as T;
    if (path.endsWith('/test')) return { ok: testOk, elapsedMs: 2, ...!testOk ? { error: 'Fixture rejected the subscription request' } : {} } as T;
    if (path.endsWith('/activate')) { settings.activate(CHATGPT_ENDPOINT); return {} as T; }
    if (path === '/api/run/resume') { paused = false; return {} as T; }
    throw new Error(`Unexpected console route: ${path}`);
  };
  return { call, cfg, state: () => state, paused: () => paused, dir };
}

describe('personal subscription in the upstream guide and editor', () => {
  it('connects through the parent capability and retains the saved catalog model without exporting a login URL or tokens', async () => {
    const f = fixture();
    const result = await connectChatGPT(f.call, () => { throw new Error('An authorization URL reached the caller'); }, { pollMs: 1 });
    expect(result.ok).toBe(true);
    expect(f.paused()).toBe(false);
    expect(f.cfg.providers[CHATGPT_ENDPOINT].spec!.model).toBe('fixture-second');
    expect(await chatgptState(f.call, CHATGPT_ENDPOINT)).toMatchObject({ signedIn: true, phase: 'done' });
    expect(JSON.stringify(await chatgptState(f.call, CHATGPT_ENDPOINT))).not.toContain('fixture-private-token');
    const saved = readFileSync(join(f.dir, 'providers', CHATGPT_ENDPOINT, 'config.json'), 'utf8');
    expect(saved).not.toContain('fixture-private-token');
    expect(existsSync(join(f.dir, 'providers', CHATGPT_ENDPOINT, '.env'))).toBe(false);
  });

  it('leaves the subscription selected and the run paused after a failed test', async () => {
    const f = fixture(false);
    expect((await connectChatGPT(f.call, () => {}, { pollMs: 1 })).ok).toBe(false);
    expect(f.cfg.activeProvider).toBe(CHATGPT_ENDPOINT);
    expect(Object.keys(f.cfg.providers)).toEqual([CHATGPT_ENDPOINT]);
    expect(f.paused()).toBe(true);
  });

  it('the advanced account editor signs out the same shared parent session and pauses delivery', async () => {
    const f = fixture(true, true);
    await connectChatGPT(f.call, () => {}, { pollMs: 1 });
    expect(f.paused()).toBe(false);
    expect((await signOutChatGPT(f.call, CHATGPT_ENDPOINT)).signedIn).toBe(false);
    expect(f.state().sharing).toBe(false);
    expect(f.paused()).toBe(true);
    expect((await chatgptState(f.call, CHATGPT_ENDPOINT)).phase).toBe('idle');
  });
});
