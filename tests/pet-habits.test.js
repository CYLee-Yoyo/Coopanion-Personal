import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConsoleUi } from '../console/base/ui/index.ts';
import { petPage } from '../console/features/pet/index.ts';
import { S } from '../console/features/pet/strings.ts';
import { DESKTOP_PET_DEFAULTS } from '../packages/cortico-world-desktop-pet/src/config.ts';

const cleanups = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals(); });
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const key = 'worlds.desktop-pet.window.perchWindows';

function fixture() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  cleanups.push(() => dom.window.close());
  const scratch = fileURLToPath(new URL('../scratch/', import.meta.url)); mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'pet-habits-'));
  cleanups.push(() => {
    const inside = relative(scratch, dir);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Fixture path is outside scratch');
    rmSync(dir, { recursive: true, force: true });
  });
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify({ [key]: DESKTOP_PET_DEFAULTS.window.perchWindows }));
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  let supported = true, reject = false;
  vi.stubGlobal('fetch', async (url, init = {}) => {
    await Promise.resolve();
    if (init.signal?.aborted) throw new dom.window.DOMException('View closed', 'AbortError');
    if (url === '/api/config' && init.method === 'POST') {
      if (reject) return new Response(JSON.stringify({ error: 'Fixture save rejected' }), { status: 400 });
      const update = JSON.parse(init.body);
      writeFileSync(file, JSON.stringify({ ...read(), ...update.values }));
      return reply({ ok: true });
    }
    if (url === '/api/config') return reply({ groups: [{ group: { id: 'world:desktop-pet' }, values: supported ? read() : {} }] });
    if (String(url).startsWith('/api/config/options/')) return reply({ options: [] });
    if (String(url).endsWith('/panels/pet/state')) return reply({ defaultUser: 'Fixture',
      wake: { wakeOn: 'poke', wakeKinds: ['poke'] }, selfAdjust: { mode: 'default', custom: {} } });
    throw new Error('Unexpected fixture route');
  });
  const mount = async () => {
    const controller = new dom.window.AbortController();
    const root = document.createElement('div'); document.body.append(root);
    const ui = createConsoleUi({ doc: document, overlayHost: document.body, signal: controller.signal,
      memo: { get: (_key, fallback) => fallback, set() {} } });
    await petPage.mount({ root, ui, signal: controller.signal, lifecycle: { interval() {} } });
    const row = [...root.querySelectorAll('.companion-row')].find(row => row.querySelector('.companion-label')?.textContent === S.perchWindowsLabel);
    const dispose = () => { controller.abort(); root.remove(); }; cleanups.push(dispose);
    return { root, row, checkbox: row.querySelector('input'), dispose };
  };
  return { mount, read, unsupported: () => { supported = false; }, reject: () => { reject = true; } };
}

describe('window-interaction setting', () => {
  it('saves an on/off choice across page navigation, including immediate navigation after submission', async () => {
    const f = fixture(), view = await f.mount();
    expect(view.row.hidden).toBe(false);
    expect(view.checkbox.checked).toBe(DESKTOP_PET_DEFAULTS.window.perchWindows);
    view.checkbox.click(); view.dispose();
    await vi.waitFor(() => expect(f.read()[key]).toBe(!DESKTOP_PET_DEFAULTS.window.perchWindows));
    expect((await f.mount()).checkbox.checked).toBe(!DESKTOP_PET_DEFAULTS.window.perchWindows);
  });

  it('hides the setting when the platform does not declare it', async () => {
    const f = fixture(); f.unsupported();
    expect((await f.mount()).row.hidden).toBe(true);
  });

  it('shows a save failure while preserving the previously stored choice', async () => {
    const f = fixture(), view = await f.mount(); f.reject(); view.checkbox.click();
    await vi.waitFor(() => expect(view.root.querySelector('.msgline.bad')).not.toBeNull());
    expect(f.read()[key]).toBe(DESKTOP_PET_DEFAULTS.window.perchWindows);
  });
});
