import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { message } from 'cortico/protocol/open-responses/context.ts';
import { setByPath } from 'cortico/core/config-schema.ts';
import { CUA_DEFAULTS } from '../packages/cortico-world-desktop-pet/src/cua/config.ts';
import { ScriptedModel, startBot } from '../packages/cortico-world-desktop-pet/tests/helpers/harness.ts';
import { createConsoleUi } from '../console/base/ui/index.ts';
import { cuaSection } from '../console/features/cua/index.ts';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllGlobals(); });
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function removeTemp(dir) {
  const rel = relative(tmpdir(), dir);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Test directory is outside temporary storage');
  rmSync(dir, { recursive: true, force: true });
}

async function fixture() {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  cleanups.push(() => dom.window.close());
  const dir = mkdtempSync(join(tmpdir(), 'coopanion-cua-test-'));
  cleanups.push(() => removeTemp(dir));
  const template = join(dir, 'env.md');
  writeFileSync(template, 'Computer enabled: {{enabled}}. Input allowed: {{control}}. Permission: {{permission}}. Grant: {{grant}}.');
  let live; let host; let actions = 0;
  const model = new ScriptedModel(turn => ({ calls: [
    ...(turn.tools.includes('fixture_computer') ? [{ name: 'fixture_computer' }] : []), { name: 'end_turn' },
  ] }));
  const bot = await startBot({ model, worlds: [{
    id: 'desktop-pet', label: 'fixture', defaults: () => ({ enabled: true, cua: structuredClone(CUA_DEFAULTS) }),
    create: ctx => {
      live = ctx.cfg;
      return {
        id: ctx.id,
        envPromptVars: () => ({ enabled: String(live.cua.enabled), control: String(live.cua.control), permission: live.cua.permission, grant: String(live.cua.grantMinutes) }),
        tools: () => live.cua.enabled ? [{ name: 'fixture_computer', description: 'Read the fixture.', tags: ['read'],
          parameters: { type: 'object', properties: {}, required: [] }, handler: async () => { actions++; return 'fixture read'; } }] : [],
        webUi: () => ({ promptDocs: [{ key: 'worlds.desktop-pet.envPrompt', title: 'fixture', description: 'fixture', path: template, role: 'envPrompt' }] }),
        start: async next => { host = next; }, stop: async () => {},
      };
    },
  }] });
  cleanups.push(async () => { await bot.stop(); removeTemp(dirname(bot.parts.persona.memoryDir)); });
  await vi.waitFor(() => expect(bot.core.session.records.length).toBe(1));
  bot.core.session.append(message('user', 'fixture history'));
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(live.cua));
  let failSave = false; let failApply = false;
  vi.stubGlobal('fetch', async (url, init = {}) => {
    await Promise.resolve();
    if (init.signal?.aborted) throw new Error('View closed');
    if (String(url) === '/api/config' && init.method !== 'POST') return reply({ groups: [{ group: { id: 'world:desktop-pet:cua' },
      values: Object.fromEntries(Object.entries(live.cua).map(([key, value]) => [`worlds.desktop-pet.cua.${key}`, value])) }] });
    if (String(url) === '/api/config') {
      if (failSave) return new Response(JSON.stringify({ error: 'fixture save rejected' }), { status: 400 });
      const body = JSON.parse(init.body);
      const config = { worlds: { 'desktop-pet': live } };
      for (const [key, value] of Object.entries(body.values)) setByPath(config, key, value);
      writeFileSync(configPath, JSON.stringify(live.cua));
      return reply({ result: 'stored' });
    }
    if (String(url) === '/api/session/reload-prefix') {
      if (failApply) return new Response(JSON.stringify({ error: 'fixture apply rejected' }), { status: 503 });
      await bot.core.loop.reloadSystemPrefix();
      return reply({ ok: true });
    }
    throw new Error('Unexpected local request');
  });
  const mount = async () => {
    const controller = new window.AbortController();
    const root = document.createElement('div'); document.body.append(root);
    const ui = createConsoleUi({ doc: document, overlayHost: document.body, signal: controller.signal,
      memo: { get: (_key, fallback) => fallback, set() {} } });
    const row = (label, control) => { const el = ui.h('div'); el.append(ui.h('span', '', label), control); return el; };
    root.append(cuaSection({ ui, signal: controller.signal }, row));
    const enabled = root.querySelector('input[type="checkbox"]');
    await vi.waitFor(() => expect(root.querySelector('input[type="number"]').value).toBe(String(live.cua.grantMinutes)));
    const dispose = () => { controller.abort(); root.remove(); };
    cleanups.push(dispose);
    return { root, enabled, message: root.querySelector('.msgline'), dispose };
  };
  return { bot, model, mount, live, actions: () => actions, prefix: () => JSON.stringify(bot.core.session.records[0]),
    tools: () => bot.core.loop.getToolSchemas().map(tool => tool.name), read: () => JSON.parse(readFileSync(configPath, 'utf8')),
    rejectSave: () => { failSave = true; }, rejectApply: () => { failApply = true; },
    wake: () => host.pushEvent({ type: 'desktop-pet.request', source: 'desktop-pet', senderKey: 'fixture', ts: new Date().toISOString(), text: 'read the fixture' }, { trigger: 'flush' }),
  };
}

describe('computer-use setting synchronization', () => {
  it('updates Core tools and instructions before the next model request, preserving history and permissions', async () => {
    const f = await fixture(); const view = await f.mount();
    expect(f.tools()).not.toContain('fixture_computer');
    const tail = structuredClone(f.bot.core.session.records.slice(1));
    view.enabled.click();
    await vi.waitFor(() => expect(view.enabled.disabled).toBe(false));
    expect(f.read().enabled).toBe(true);
    expect(f.tools()).toContain('fixture_computer');
    expect(f.prefix()).toContain('Computer enabled: true');
    expect(f.bot.core.session.records.slice(1)).toEqual(tail);
    expect(f.live.cua.permission).toBe(CUA_DEFAULTS.permission);
    expect(f.live.cua.grantMinutes).toBe(CUA_DEFAULTS.grantMinutes);
    await f.wake();
    await vi.waitFor(() => expect(f.actions()).toBe(1));
    expect(f.model.turns[0].tools).toContain('fixture_computer');
    expect(JSON.stringify(f.model.turns[0].records)).toContain('Computer enabled: true');
    view.enabled.click();
    await vi.waitFor(() => expect(view.enabled.disabled).toBe(false));
    expect(f.tools()).not.toContain('fixture_computer');
    expect(f.prefix()).toContain('Computer enabled: false');
  });

  it('finishes saving and synchronizing when the settings page closes immediately', async () => {
    const f = await fixture(); const view = await f.mount();
    view.enabled.click(); view.dispose();
    await vi.waitFor(() => expect(f.tools()).toContain('fixture_computer'));
    expect(f.read().enabled).toBe(true);
    expect((await f.mount()).enabled.checked).toBe(true);
  });

  it('reports a failed synchronization without claiming the persisted setting is active', async () => {
    const f = await fixture(); const view = await f.mount(); f.rejectApply();
    view.enabled.click();
    await vi.waitFor(() => expect(view.message.classList.contains('bad')).toBe(true));
    expect(f.read().enabled).toBe(true);
    expect(f.tools()).not.toContain('fixture_computer');
    expect(f.prefix()).toContain('Computer enabled: false');
  });

  it('leaves tools and the prefix unchanged when the setting cannot be saved', async () => {
    const f = await fixture(); const view = await f.mount(); f.rejectSave();
    view.enabled.click();
    await vi.waitFor(() => expect(view.message.classList.contains('bad')).toBe(true));
    expect(f.read().enabled).toBe(false);
    expect(f.tools()).not.toContain('fixture_computer');
    expect(f.prefix()).toContain('Computer enabled: false');
  });
});
