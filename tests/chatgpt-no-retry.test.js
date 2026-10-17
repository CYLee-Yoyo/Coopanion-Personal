/** Real Core failure handling must not resubmit a subscription request or select another provider. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname, isAbsolute, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { ChatGPTClient } from '../packages/cortico-provider-coo/src/chatgpt/client.ts';
import { suspendChatGPT } from '../core/chatgpt-session.ts';
import { ScriptedModel, startBot } from '../packages/cortico-world-desktop-pet/tests/helpers/harness.ts';

const bots = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) {
    await bot.stop();
    const dir = dirname(bot.parts.persona.memoryDir);
    const inside = relative(tmpdir(), dir);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Fixture directory is outside temporary storage');
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('subscription failures through Core', () => {
  it.each([401, 429, 503, 0, 200])('pauses after one failed request (%s), including Core resubmission; resume is explicit', async status => {
    const session = { status: () => ({ connected: true, sharing: true, pending: false, account: 'fixture', email: null, error: null }),
      action: async () => session.status(), token: async () => ({ accessToken: 'fixture-access-token', account: 'fixture' }) };
    let calls = 0; let stop = () => {}; let host;
    const client = new ChatGPTClient(session, undefined, () => stop(), async () => {
      calls++;
      if (!status) throw new TypeError('Fixture connection failed');
      return status === 200
        ? new Response('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n')
        : new Response('{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}', { status });
    });
    const model = new ScriptedModel(() => ({ calls: [{ name: 'end_turn' }] }));
    model.respond = client.respond.bind(client);
    const bot = await startBot({ model, worlds: [{ id: 'fixture', label: 'Fixture', defaults: () => ({ enabled: true }), create: () => ({
      id: 'fixture', tools: () => [], envPromptVars: () => null, start: async next => { host = next; }, stop: async () => {},
    }) }] });
    bots.push(bot);
    stop = () => suspendChatGPT(bot.core);
    const provider = bot.core.config.activeProvider;
    let phase = '';
    bot.core.loop.onRunPhase(next => { phase = next.state; });
    const request = async () => host.pushEvent({ type: 'fixture.request', source: 'fixture', senderKey: 'fixture', ts: new Date().toISOString(), text: 'Fixture request' }, { trigger: 'flush' });
    await request();
    await vi.waitFor(() => { expect(bot.core.bus.isPaused()).toBe(true); expect(phase).toBe('idle'); });
    expect(calls).toBe(1);
    expect(bot.core.config.activeProvider).toBe(provider);
    bot.core.bus.setPaused(false);
    await request();
    await vi.waitFor(() => { expect(calls).toBe(2); expect(bot.core.bus.isPaused()).toBe(true); expect(phase).toBe('idle'); });
    expect(bot.core.config.activeProvider).toBe(provider);
  });
});
