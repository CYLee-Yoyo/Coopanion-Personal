import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderRegistry } from 'cortico/providers/registry.ts';
import { ProviderSettings } from 'cortico/providers/webui/settings.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { createChatGPTModule } from '../packages/cortico-provider-coo/src/chatgpt/index.ts';
import { CHATGPT_BASE_URL, CHATGPT_ENDPOINT, CHATGPT_KIND } from '../packages/cortico-provider-coo/src/chatgpt/types.ts';
import { createConsoleUi } from '../console/base/ui/index.ts';
import { mountChatGPT } from '../console/features/home/chatgpt.ts';

const cleanups = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function fixture() {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('Event', dom.window.Event);
  vi.stubGlobal('DOMException', dom.window.DOMException);
  cleanups.push(() => dom.window.close());
  const dir = mkdtempSync(join(tmpdir(), 'coopanion-ui-test-'));
  const temp = { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  const withinTemp = relative(tmpdir(), temp.dir);
  if (!withinTemp || withinTemp.startsWith('..') || isAbsolute(withinTemp)) throw new Error('Test directory is outside temporary storage');
  cleanups.push(temp.cleanup);
  const state = { connected: true, sharing: true, pending: false, account: 'fixture-account', email: null, error: null };
  const session = { status: () => state, action: async () => state, token: async () => ({ accessToken: 'fixture-token', account: state.account }) };
  const module = createChatGPTModule(session, () => {});
  const cfg = { providers: { [CHATGPT_ENDPOINT]: { kind: CHATGPT_KIND, baseUrl: CHATGPT_BASE_URL,
    spec: { model: 'fixture-first', thinking: true, reasoningEffort: 'low' } } }, activeProvider: CHATGPT_ENDPOINT };
  const providersDir = join(temp.dir, 'providers');
  const settings = new ProviderSettings(cfg, new ProviderRegistry(() => cfg.providers, {
    stateRoot: providersDir, readBlob: () => null, keepThinking: () => true, log: nullLogger(),
  }, [module]), join(temp.dir, 'config.json'), providersDir, [module]);
  const invoke = (method, args = []) => settings.sources().find(source => source.id === `llm:${CHATGPT_KIND}`)
    .contribute('en').invoke('auth', method, args);
  let gate = null;
  let catalogFails = false;
  vi.stubGlobal('fetch', async (url, init = {}) => {
    if (String(url) === `${CHATGPT_BASE_URL}/models`) {
      if (gate) await gate;
      if (catalogFails) return new Response('{}', { status: 503 });
      return reply({ models: [{ slug: 'fixture-first', visibility: 'list' }, { slug: 'fixture-second', visibility: 'list' }] });
    }
    const method = String(url).split('/').at(-1);
    const { args = [] } = JSON.parse(init.body ?? '{}');
    // A page can leave before a normal fetch is dispatched; keepalive writes still reach the server.
    await Promise.resolve();
    if (init.signal?.aborted) throw new DOMException('View closed', 'AbortError');
    try { return reply(await invoke(method, args)); }
    catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
  });
  const mount = async () => {
    const controller = new window.AbortController();
    const root = document.createElement('div'); document.body.append(root);
    const ui = createConsoleUi({ doc: document, overlayHost: document.body, signal: controller.signal,
      memo: { get: (_key, fallback) => fallback, set() {} } });
    const view = mountChatGPT({ root, ui, signal: controller.signal });
    await view.refreshModel();
    const dispose = () => { controller.abort(); root.remove(); };
    cleanups.push(dispose);
    return { ...view, root, dispose, select: root.querySelector('[role="combobox"]'), message: root.querySelector('.msgline') };
  };
  return { mount, invoke, cfg, setGate: value => { gate = value; }, failCatalog: () => { catalogFails = true; },
    read: () => JSON.parse(readFileSync(join(providersDir, CHATGPT_ENDPOINT, 'config.json'), 'utf8')) };
}

const change = (select, value) => {
  select.click();
  const list = document.getElementById(select.getAttribute('aria-controls'));
  const option = Array.from(list.children).find(option => option.textContent === value);
  expect(option).toBeDefined();
  option.click();
};
const key = (control, value) => control.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));

describe('ChatGPT model selection', () => {
  it('saves a changed model to disk and restores it on a new page without a connectivity probe', async () => {
    const f = fixture(); const first = await f.mount();
    change(first.select, 'fixture-second');
    await vi.waitFor(() => expect(f.cfg.providers[CHATGPT_ENDPOINT].spec.model).toBe('fixture-second'));
    expect(f.read().spec.model).toBe('fixture-second');
    first.dispose();
    const reopened = await f.mount();
    expect(reopened.select.value).toBe('fixture-second');
  });

  it('finishes a submitted save when navigation closes the view before dispatch', async () => {
    const f = fixture(); const first = await f.mount();
    let release; f.setGate(new Promise(resolve => { release = resolve; }));
    change(first.select, 'fixture-second');
    first.dispose(); release();
    await vi.waitFor(() => expect(f.cfg.providers[CHATGPT_ENDPOINT].spec.model).toBe('fixture-second'));
    expect((await f.mount()).select.value).toBe('fixture-second');
  });

  it('shows a rejected save and restores the last configured model', async () => {
    const f = fixture(); const view = await f.mount(); f.failCatalog();
    change(view.select, 'fixture-second');
    await vi.waitFor(() => expect(view.select.disabled).toBe(false));
    expect(view.message.classList.contains('bad')).toBe(true);
    expect(view.message.textContent).not.toBe('');
    expect(view.select.value).toBe('fixture-first');
    expect(f.cfg.providers[CHATGPT_ENDPOINT].spec.model).toBe('fixture-first');
  });

  it('refreshes the selection after another view changes the saved provider', async () => {
    const f = fixture(); const view = await f.mount();
    await f.invoke('select', ['fixture-second']);
    await view.refreshModel();
    expect(view.select.value).toBe('fixture-second');
  });

  it('navigates the list by keyboard and saves only the confirmed choice', async () => {
    const f = fixture(); const view = await f.mount(); view.select.focus();
    key(view.select, 'ArrowDown');
    expect(view.select.getAttribute('aria-expanded')).toBe('true');
    key(view.select, 'End');
    expect(document.getElementById(view.select.getAttribute('aria-activedescendant')).textContent).toBe('fixture-second');
    expect(view.select.value).toBe('fixture-first');
    key(view.select, 'Escape');
    expect(view.select.getAttribute('aria-expanded')).toBe('false');
    expect(f.cfg.providers[CHATGPT_ENDPOINT].spec.model).toBe('fixture-first');
    key(view.select, ' '); key(view.select, 'Home'); key(view.select, 'ArrowDown'); key(view.select, 'Enter');
    await vi.waitFor(() => expect(view.select.disabled).toBe(false));
    expect(view.select.getAttribute('aria-expanded')).toBe('false');
    expect(f.read().spec.model).toBe('fixture-second');
    expect(view.select.textContent).toBe('fixture-second');
  });

  it('closes on outside interaction and focus loss without changing the saved model', async () => {
    const f = fixture(); const view = await f.mount(); view.select.focus();
    view.select.click();
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(view.select.getAttribute('aria-expanded')).toBe('false');
    view.select.click();
    view.root.querySelector('.btn').focus();
    expect(view.select.getAttribute('aria-expanded')).toBe('false');
    expect(f.cfg.providers[CHATGPT_ENDPOINT].spec.model).toBe('fixture-first');
  });
});
