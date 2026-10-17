import { describe, expect, it } from 'vitest';
import { createResponse, type Request } from 'cortico/protocol/open-responses/index.ts';
import { ChatGPTClient, ChatGPTError, listChatGPTModels, subscriptionBody, subscriptionEvent } from '../src/chatgpt/client.ts';
import type { ChatGPTSession } from '../src/chatgpt/types.ts';

const session: ChatGPTSession = { status: () => ({ connected: true, sharing: true, pending: false, email: null, account: 'test', error: null }),
  action: async () => session.status(), token: async () => ({ accessToken: 'test-oauth-token', account: 'test' }) };
const request: Request = { model: 'fixture-model', input: [{ type: 'message', role: 'user', content: 'ping' }] };
const completed = createResponse('response-test', request);
completed.status = 'completed';
const eventStream = (events: unknown[]) => new Response(new ReadableStream({ start(controller) {
  for (const event of events) { const line = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`); controller.enqueue(line.subarray(0, 9)); controller.enqueue(line.subarray(9)); }
  controller.close();
} }), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'request-test' } });
const events = [{ type: 'response.created', sequence_number: 0, response: { ...completed, status: 'in_progress' } },
  { type: 'response.completed', sequence_number: 1, response: completed }];

describe('ChatGPT subscription transport', () => {
  const failures = [
    ['subscription_sharing_usage_limit_exceeded', 429, 'usage-limit'],
    ['subscription_sharing_invalid_user', 401, 'authorization'],
    ['chatpass_v2_scope_not_authorized', 403, 'permission'],
    ['chatpass_v2_invalid_authorization_context', 403, 'permission'],
    ['subscription_sharing_user_not_eligible', 403, 'ineligible'],
    ['subscription_sharing_usage_unavailable', 503, 'unavailable'],
    ['subscription_sharing_user_unavailable', 503, 'unavailable'],
    ['subscription_sharing_unsupported_capability', 400, 'unsupported'],
    ['subscription_sharing_route_not_supported', 403, 'unsupported'],
  ] as const;
  for (const transport of ['http', 'stream']) {
    it.each(failures)(`classifies ${transport} %s without retaining private error text or retrying inference`, async (code, status, reason) => {
      let calls = 0;
      const client = new ChatGPTClient(session, undefined, () => {}, (async () => {
        calls++;
        const error = { code, message: 'PRIVATE-ERROR-TEXT', param: 'PRIVATE-INPUT' };
        return transport === 'http' ? new Response(JSON.stringify({ error }), { status })
          : eventStream([events[0], { type: 'response.failed', response: { error } }]);
      }) as typeof fetch);
      let caught: unknown;
      try { await client.respond(request); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ChatGPTError);
      expect(caught).toMatchObject({ reason, body: JSON.stringify({ error: { code } }) });
      expect(String(caught)).not.toContain('PRIVATE');
      expect(calls).toBe(1);
    });
  }

  it.each([
    [429, 'unavailable'], [503, 'unavailable'], [403, 'permission'], [401, 'authorization'], [400, 'unknown'],
  ] as const)('classifies admission HTTP %s without depending on the response body shape', async (status, reason) => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => new Response('{"detail":"PRIVATE-TEXT"}', { status })) as typeof fetch);
    await expect(client.respond(request)).rejects.toMatchObject({ reason });
  });

  it.each([
    [new TypeError('PRIVATE-TEXT'), 'network'], [new DOMException('PRIVATE-TEXT', 'TimeoutError'), 'timeout'],
  ] as const)('classifies transport failures without exposing the original message', async (error, reason) => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => { throw error; }) as typeof fetch);
    await expect(client.respond(request)).rejects.toMatchObject({ reason });
    await expect(client.respond(request)).rejects.not.toThrow('PRIVATE-TEXT');
  });

  it('reads the account-specific catalog without substituting API catalog models', async () => {
    const models = await listChatGPTModels(session, (async () => new Response(JSON.stringify({ models: [
      { slug: 'available-model', display_name: 'Available', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hidden' },
    ] }))) as typeof fetch);
    expect(models).toEqual([{ id: 'available-model', displayName: 'Available' }]);
  });

  it('removes unsupported parameters and places local tools in a namespace', () => {
    const body = subscriptionBody({ ...request, max_output_tokens: 256, temperature: 0.5,
      tools: [{ type: 'function', name: 'fixture_read', description: 'Read', parameters: { type: 'object', properties: {} } }] }, {}, undefined);
    expect(body).toMatchObject({ store: false, stream: true, tools: [{ type: 'namespace', name: 'coo', tools: [{ name: 'fixture_read', strict: false }] }] });
    expect(body).not.toHaveProperty('max_output_tokens'); expect(body).not.toHaveProperty('temperature');
  });

  it('consumes SSE through completion even for a probe without an onEvent callback', async () => {
    let sent: Record<string, unknown> | null = null;
    const client = new ChatGPTClient(session, undefined, () => {}, (async (_url, init) => { sent = JSON.parse(String(init?.body)); return eventStream(events); }) as typeof fetch);
    const result = await client.respond(request, { diagnostic: true });
    expect(sent).toMatchObject({ stream: true, store: false }); expect(result.response.status).toBe('completed');
    expect(result.attempts).toHaveLength(1); expect(result.attempts[0]).toMatchObject({ outcome: 'completed', requestId: 'request-test', charges: [] });
  });

  it('retains completed streamed output when the terminal receipt omits it', async () => {
    const item = { type: 'message', id: 'message-test', role: 'assistant', status: 'in_progress', content: [] };
    const part = { type: 'output_text', text: '', annotations: [] };
    const finalPart = { ...part, text: 'pong' };
    const finalItem = { ...item, status: 'completed', content: [finalPart] };
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item },
      { type: 'response.content_part.added', sequence_number: 2, output_index: 0, item_id: item.id, content_index: 0, part },
      { type: 'response.output_text.delta', sequence_number: 3, output_index: 0, item_id: item.id, content_index: 0, delta: 'pong' },
      { type: 'response.content_part.done', sequence_number: 4, output_index: 0, item_id: item.id, content_index: 0, part: finalPart },
      { type: 'response.output_item.done', sequence_number: 5, output_index: 0, item: finalItem },
      { ...events[1], sequence_number: 6 },
    ])) as typeof fetch);
    const result = await client.respond(request, { diagnostic: true });
    expect(result.response.output).toEqual([finalItem]); expect(result.attempts[0].outcome).toBe('completed');
  });

  it('does not promote an unfinished streamed tool when the terminal receipt omits output', async () => {
    const item = { type: 'function_call', id: 'function-test', call_id: 'call-test', name: 'fixture_read', arguments: '', status: 'in_progress' };
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item },
      { ...events[1], sequence_number: 2 },
    ])) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('terminal_outputs');
  });

  it('ignores transport metadata while preserving output through completed inference', async () => {
    const item = { type: 'message', id: 'message-test', role: 'assistant', status: 'completed', content: [] };
    const received: string[] = [];
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      { type: 'response.metadata', metadata: { note: 'fixture-private-metadata' } }, events[0],
      { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item },
      { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
      { type: 'response.metadata', sequence_number: 3, headers: { 'fixture-header': 'fixture-private-header' } },
      { ...events[1], sequence_number: 4, response: { ...completed, output: [item] } },
    ])) as typeof fetch);
    const result = await client.respond(request, { onEvent: event => received.push(event.type) });
    expect(result.response.output).toEqual([item]);
    expect(received).not.toContain('response.metadata');
    expect(result.attempts[0].outcome).toBe('completed');
    expect(JSON.stringify(result)).not.toContain('fixture-private');
  });

  it('requires a terminal response even when metadata contains a completed-looking resource', async () => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { type: 'response.metadata', response: completed },
    ])) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('未收到完整回覆');
  });

  it('rejects repeated wire sequence numbers before normalizing the stream', async () => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { ...events[1], sequence_number: 0 },
    ])) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('event_sequence');
  });

  it('reports incomplete inference separately even when its partial output was not announced', async () => {
    const item = { type: 'message', id: 'message-test', role: 'assistant', status: 'in_progress', content: [] };
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { type: 'response.incomplete', sequence_number: 1,
        response: { ...completed, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [item] } },
    ])) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('未完成（max_output_tokens）');
  });

  it('rejects a terminal resource that changes an already completed item', async () => {
    const item = { type: 'message', id: 'message-test', role: 'assistant', status: 'completed', content: [] };
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item },
      { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
      { type: 'response.completed', sequence_number: 3, response: { ...completed, output: [{ ...item, role: 'system' }] } },
    ])) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('terminal_item');
  });

  it('stops on a late subscription limit error without retrying or switching credentials', async () => {
    let requests = 0; let reason = '';
    const client = new ChatGPTClient(session, undefined, value => { reason = value; }, (async () => {
      requests++; return eventStream([events[0], { type: 'response.metadata', sequence_number: 1 }, { type: 'response.failed', sequence_number: 2,
        response: { ...completed, status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]);
    }) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('上限'); expect(requests).toBe(1); expect(reason).toContain('停止請求');
  });

  it('rejects a stream that ends before response.completed', async () => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([events[0]])) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow('未收到完整回覆');
  });

  it('normalizes the function namespace identically in items and the terminal resource', () => {
    const item = { type: 'function_call', id: 'fc_test', name: 'coo.fixture_read', namespace: 'coo', call_id: 'call-test', arguments: '{}' };
    const added = subscriptionEvent({ type: 'response.output_item.added', item }) as unknown as { item: Record<string, unknown> };
    const done = subscriptionEvent({ type: 'response.completed', response: { output: [item] } }) as unknown as { response: { output: unknown[] } };
    expect(added.item.name).toBe('fixture_read'); expect(added.item).not.toHaveProperty('namespace'); expect(done.response.output[0]).toEqual(added.item);
  });

  it('rejects a malformed header credential without copying it into the error', async () => {
    const unsafeSession = { ...session, token: async () => ({ accessToken: 'private-credential\r\nInjected: value', account: 'test' }) };
    let sent = false;
    const client = new ChatGPTClient(unsafeSession, undefined, () => {}, (async () => { sent = true; return eventStream(events); }) as typeof fetch);
    let message = ''; try { await client.respond(request); } catch (error) { message = String(error); }
    expect(sent).toBe(false); expect(message).not.toContain('private-credential'); expect(message).toContain('憑證格式不符');
  });

  it('does not include a malformed stream payload in error records', async () => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => new Response('data: private-credential NOT JSON\n\n', { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch);
    let message = ''; try { await client.respond(request); } catch (error) { message = String(error); }
    expect(message).not.toContain('private-credential'); expect(message).toContain('串流格式不符');
  });

  it('reports a fixed protocol category without exposing event content', async () => {
    const client = new ChatGPTClient(session, undefined, () => {}, (async () => eventStream([
      events[0], { type: 'private-credential', sequence_number: 1, data: 'private-content' },
    ])) as typeof fetch);
    let message = ''; try { await client.respond(request); } catch (error) { message = String(error); }
    expect(message).toContain('event_type'); expect(message).not.toContain('private-credential'); expect(message).not.toContain('private-content');
  });

  it('does not send a request after the account connection is stopped', async () => {
    const connection = new AbortController(); connection.abort(); let sent = false;
    const stoppedSession = { ...session, signal: () => connection.signal };
    const client = new ChatGPTClient(stoppedSession, undefined, () => {}, (async () => { sent = true; return eventStream(events); }) as typeof fetch);
    await expect(client.respond(request)).rejects.toThrow(); expect(sent).toBe(false);
  });
});
