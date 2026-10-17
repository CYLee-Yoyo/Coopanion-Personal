/** The real page and World panel preserve submitted decisions across navigation and render public content as text. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResponse } from 'cortico/protocol/open-responses/index.ts';
import { ChatGPTError } from '../packages/cortico-provider-coo/src/chatgpt/client.ts';
import { createConsoleUi } from '../console/base/ui/index.ts';
import { LANGUAGE } from '../console/base/language.ts';
import { mountUpdates } from '../console/features/updates/index.ts';
import { NoticeWorld } from '../core/notice.ts';
import { UpstreamWatch } from '../core/upstream-watch.ts';
import { PERSONAL_FEATURES, UPSTREAM_BASE } from '../core/personal-upstream.ts';
import { upstreamText } from '../core/upstream-strings.ts';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllGlobals(); });
const S = upstreamText(LANGUAGE);

async function fixture(failure = null) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  for (const name of ['window', 'document', 'HTMLElement', 'Event', 'DOMException']) vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name]);
  const dir = mkdtempSync(join(tmpdir(), 'coo-update-page-'));
  cleanups.push(() => dom.window.close(), () => rmSync(dir, { recursive: true, force: true }));
  const payload = { summary: '<img src=x onerror=alert(1)>', changes: ['<b>public text</b>'], risks: ['Needs manual review'], recommendation: 'Integrate in Codex',
    features: PERSONAL_FEATURES.map(({ id }) => ({ id, assessment: 'Verify preservation' })) };
  let calls = 0;
  const watch = new UpstreamWatch({ dir, installedVersion: 'fixture', language: () => LANGUAGE, paused: () => false,
    canNotify: () => false, notify: () => ({ answer: Promise.resolve('closed'), close() {} }),
    subscription: () => ({ model: 'fixture-model', client: { respond: async request => {
      calls++;
      if (failure) throw new ChatGPTError(failure, 'PRIVATE-ERROR-TEXT', [], null, {});
      const response = createResponse('fixture-response', request); response.status = 'completed';
      response.output = [{ id: 'fixture-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(payload), annotations: [] }] }];
      return { response, attempts: [], origin: {} };
    } } }),
    source: { latest: async () => ({ version: '9.1.0', tag: 'v9.1.0', title: 'Fixture', notes: '<script>publicNotes()</script>',
      url: 'https://github.com/Pal-AI-Lab/Coopanion/releases/tag/v9.1.0', publishedAt: null }),
    diff: async () => ({ head: '1'.repeat(40), compareUrl: `https://github.com/Pal-AI-Lab/Coopanion/compare/${UPSTREAM_BASE.commit}...${'1'.repeat(40)}`, files: [], overlaps: [], limitations: [] }) },
  });
  watch.start(); await watch.check(); cleanups.push(() => watch.stop());
  const world = new NoticeWorld({ version: 'dev', notesDir: dir, stateFile: join(dir, 'notice.json'), alarmsFile: join(dir, 'alarms.json'),
    newInstall: () => true, read: () => undefined, petConnected: () => false, guiding: () => false, label: () => 'Fixture', upstream: () => watch }, 'UTC');
  const panel = world.webUi(LANGUAGE);
  let gate = null;
  const requests = [];
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const method = String(url).split('/').at(-1);
    expect(String(url).startsWith('/api/webui/providers/world%3Acoopanion/panels/updates/')).toBe(true);
    requests.push({ method, init });
    if (method === 'decide' && gate) await gate;
    if (init.signal?.aborted) throw new DOMException('Page closed', 'AbortError');
    const { args = [] } = JSON.parse(init.body ?? '{}');
    try { return new Response(JSON.stringify(await panel.invoke('updates', method, args))); }
    catch { return new Response('{"error":"Rejected"}', { status: 400 }); }
  });
  const mount = async () => {
    const controller = new window.AbortController();
    const root = document.createElement('div'); document.body.append(root);
    const ui = createConsoleUi({ doc: document, overlayHost: document.body, signal: controller.signal,
      memo: { get: (_key, fallback) => fallback, set() {} } });
    let poll = async () => {};
    await mountUpdates({ root, ui, signal: controller.signal, lifecycle: { interval: fn => { poll = fn; return { dispose() {} }; } } });
    const dispose = () => { controller.abort(); root.remove(); };
    cleanups.push(dispose);
    return { root, dispose, poll: () => poll(), button: label => [...root.querySelectorAll('button')].find(button => button.textContent === label) };
  };
  return { watch, world, mount, requests, calls: () => calls, recover: () => { failure = null; }, setGate: value => { gate = value; } };
}

describe('upstream page', () => {
  it.each(['usage-limit', 'authorization', 'permission', 'network', 'timeout', 'response', 'unknown'])('shows %s across polling and navigation; only manual retry clears it', async reason => {
    const f = await fixture(reason); const view = await f.mount();
    expect(view.root.textContent).toContain(S.failures[reason]);
    expect(view.root.textContent).not.toContain('PRIVATE');
    await view.poll(); view.dispose();
    const reopened = await f.mount();
    expect(reopened.root.textContent).toContain(S.failures[reason]);
    expect(f.calls()).toBe(1);
    f.recover();
    reopened.button(S.retry).click();
    await vi.waitFor(() => expect(f.watch.snapshot().phase).toBe('ready'));
    await reopened.poll();
    expect(f.calls()).toBe(2);
    expect(reopened.root.textContent).not.toContain(S.failures[reason]);
  });

  it('renders public notes and model content as text, and never offers installation', async () => {
    const f = await fixture(); const view = await f.mount();
    expect(view.root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(view.root.querySelectorAll('img, script, iframe')).toHaveLength(0);
    expect(view.button(S.save)).toBeTruthy(); expect(view.button(S.skip)).toBeTruthy();
    expect([...view.root.querySelectorAll('a')].every(a => a.href.startsWith('https://github.com/Pal-AI-Lab/Coopanion/'))).toBe(true);
    const result = await f.world.tools().find(tool => tool.name === 'coopanion_update_report').handler({}, {});
    expect(result.text).not.toContain('publicNotes()');
    expect(JSON.parse(result.text).report.changedFiles).toBe(0);
  });

  it('finishes an accepted update request after navigation and restores kept features and the local note', async () => {
    const f = await fixture(); let releaseGate;
    f.setGate(new Promise(resolve => { releaseGate = resolve; }));
    const view = await f.mount();
    const boxes = view.root.querySelectorAll('.upstream-keep input');
    boxes[2].checked = false; boxes[2].dispatchEvent(new Event('change', { bubbles: true }));
    const note = view.root.querySelector('textarea:not([readonly])');
    note.value = 'PRIVATE-LOCAL-NOTE'; note.dispatchEvent(new Event('input', { bubbles: true }));
    view.button(S.save).click(); view.dispose(); releaseGate();
    await vi.waitFor(() => expect(f.watch.snapshot().decision?.choice).toBe('update'));
    const request = f.requests.find(r => r.method === 'decide');
    expect(request.init.keepalive).toBe(true); expect(request.init.signal).toBeUndefined();
    const reopened = await f.mount();
    expect(reopened.root.querySelectorAll('.upstream-keep input')[2].checked).toBe(false);
    expect(reopened.root.querySelector('textarea:not([readonly])').value).toBe('PRIVATE-LOCAL-NOTE');
    expect(reopened.root.querySelector('textarea[readonly]').value).toContain('PRIVATE-LOCAL-NOTE');
    expect(reopened.root.textContent).toContain(S.saved);
    expect(f.watch.request().text).toContain('PRIVATE-LOCAL-NOTE');
  });

  it('preserves unsaved selections during status polling and stores skip explicitly', async () => {
    const f = await fixture(); const view = await f.mount();
    const note = view.root.querySelector('textarea:not([readonly])');
    note.value = 'Draft'; note.dispatchEvent(new Event('input', { bubbles: true }));
    await view.poll();
    expect(note.value).toBe('Draft');
    view.button(S.skip).click();
    await vi.waitFor(() => expect(f.watch.snapshot().decision?.choice).toBe('skip'));
    expect(f.watch.request()).toBeNull();
  });
});
