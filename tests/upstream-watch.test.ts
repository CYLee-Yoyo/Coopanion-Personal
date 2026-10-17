/** Public-release fixtures and real subscription SSE exercise caching, decisions and cancellation without network access. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LANGUAGES } from 'cortico/core/language.ts';
import { createResponse, type Request } from 'cortico/protocol/open-responses/index.ts';
import { ChatGPTClient } from '../packages/cortico-provider-coo/src/chatgpt/client.ts';
import { createChatGPTModule } from '../packages/cortico-provider-coo/src/chatgpt/index.ts';
import { CHATGPT_ENDPOINT, CHATGPT_KIND, type ChatGPTSession } from '../packages/cortico-provider-coo/src/chatgpt/types.ts';
import { PERSONAL_FEATURES, UPSTREAM_BASE } from '../core/personal-upstream.ts';
import { PUBLIC_API, PublicUpstreamSource, isNewerUpstream } from '../core/upstream-source.ts';
import { parseReview, reviewInput, reviewUpstream, upstreamSubscription } from '../core/upstream-review.ts';
import { CHECK_EVERY_MS, UpstreamWatch, type UpstreamWatchOptions } from '../core/upstream-watch.ts';
import { upstreamText } from '../core/upstream-strings.ts';
import { UPSTREAM_FAILURES, type UpstreamAnalysis, type UpstreamDiff, type UpstreamRelease } from '../core/upstream-types.ts';

const HEAD = '1'.repeat(40);
const SUBHEAD = '2'.repeat(40);
const NEXT = '9.1.0';
const release: UpstreamRelease = { version: NEXT, tag: `v${NEXT}`, title: 'Fixture release', notes: 'Public notes',
  url: `https://github.com/Pal-AI-Lab/Coopanion/releases/tag/v${NEXT}`, publishedAt: null };
const analysis: UpstreamAnalysis = { summary: 'A public change needs manual review.', changes: ['Changed a settings contract.'],
  risks: ['Compatibility has not been verified.'], recommendation: 'Review and integrate locally in Codex.',
  features: PERSONAL_FEATURES.map(({ id }) => ({ id, assessment: 'Preserve and verify during integration.' })) };
const diff: UpstreamDiff = { head: HEAD, compareUrl: `https://github.com/Pal-AI-Lab/Coopanion/compare/${UPSTREAM_BASE.commit}...${HEAD}`,
  files: [{ repository: 'Coopanion', path: 'core/companion.ts', additions: 1, deletions: 1, status: 'modified', patch: '-old\n+new' }],
  overlaps: ['tracking'], limitations: [] };
const session: ChatGPTSession = { status: () => ({ connected: true, sharing: true, pending: false, email: null, account: 'fixture', error: null }),
  token: async () => ({ accessToken: 'fixture-only-token', account: 'fixture' }), action: async () => session.status() };

function sse(text = JSON.stringify(analysis)): Response {
  const request: Request = { model: 'fixture-model', input: [] };
  const response = createResponse('response-fixture', request);
  response.status = 'completed';
  response.output = [{ id: 'message-fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }];
  const item = response.output[0]!;
  const part = { type: 'output_text', text: '', annotations: [] };
  return new Response([
    { type: 'response.created', sequence_number: 0, response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', sequence_number: 2, output_index: 0, item_id: item.id, content_index: 0, part },
    { type: 'response.output_text.delta', sequence_number: 3, output_index: 0, item_id: item.id, content_index: 0, delta: text },
    { type: 'response.content_part.done', sequence_number: 4, output_index: 0, item_id: item.id, content_index: 0, part: { ...part, text } },
    { type: 'response.output_item.done', sequence_number: 5, output_index: 0, item },
    { type: 'response.completed', sequence_number: 6, response },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

const active: UpstreamWatch[] = [];
const dirs: string[] = [];
function fixture(overrides: Partial<UpstreamWatchOptions> = {}, wire?: typeof fetch) {
  const dir = overrides.dir ?? mkdtempSync(join(tmpdir(), 'coo-upstream-'));
  if (!overrides.dir) dirs.push(dir);
  const sent: string[] = [];
  let checks = 0;
  const client = new ChatGPTClient(session, undefined, () => {}, wire ?? (async (_url, init) => {
    sent.push(String(init?.body)); return sse();
  }) as typeof fetch);
  const source = { latest: async () => { checks++; return { ...release }; }, diff: async () => structuredClone(diff) };
  const options: UpstreamWatchOptions = { dir, installedVersion: `${UPSTREAM_BASE.version}-personal.fixture`, language: () => 'zh-Hant',
    source, subscription: () => ({ client, model: 'fixture-model' }), paused: () => false,
    canNotify: () => false, notify: () => ({ answer: Promise.resolve('closed'), close() {} }), ...overrides };
  const watch = new UpstreamWatch(options);
  active.push(watch);
  return { watch, dir, options, sent, checks: () => checks, client };
}
afterEach(async () => {
  for (const watch of active.splice(0)) await watch.stop();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('public upstream boundary', () => {
  const publicFetch = (alter: (route: string, value: any) => any = (_route, value) => value) => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const source = new PublicUpstreamSource((async (url, init) => {
      requests.push({ url: String(url), init });
      const route = String(url).slice(PUBLIC_API.length);
      const value = route.endsWith('releases/latest')
        ? { tag_name: release.tag, draft: false, prerelease: false, name: 'Fixture', body: 'Notes', html_url: 'https://evil.invalid/', published_at: null }
        : route.includes('git/ref/tags/') ? { object: { type: 'tag', sha: '3'.repeat(40) } }
        : route.includes('git/tags/') ? { object: { type: 'commit', sha: HEAD } }
        : { status: 'ahead', files: [{ filename: route.startsWith('Coopanion') ? 'vendor/cortico' : 'src/fixture.ts', status: 'modified', additions: 1, deletions: 1,
          patch: route.startsWith('Coopanion') ? `-Subproject commit ${UPSTREAM_BASE.corticoCommit}\n+Subproject commit ${SUBHEAD}` : '-old\n+new' }] };
      return new Response(JSON.stringify(alter(route, value)));
    }) as typeof fetch);
    return { source, requests };
  };

  it('resolves an annotated stable tag and compares fixed public commits including the dependency', async () => {
    const { source, requests } = publicFetch();
    const found = await source.latest(new AbortController().signal);
    expect(found.url).toBe(release.url);
    const changes = await source.diff(found, new AbortController().signal);
    expect(changes.head).toBe(HEAD);
    expect(changes.files.map(f => f.repository)).toEqual(['Coopanion', 'Cortico']);
    expect(requests.some(r => r.url.includes(`${UPSTREAM_BASE.commit}...${HEAD}`))).toBe(true);
    expect(requests.some(r => r.url.includes(`${UPSTREAM_BASE.corticoCommit}...${SUBHEAD}`))).toBe(true);
    for (const { url, init } of requests) {
      expect(url.startsWith(PUBLIC_API)).toBe(true);
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    }
  });

  it.each([
    { kind: 'a renamed whale renderer', file: { filename: 'packages/cortico-world-desktop-pet/web/whale/figure-next.js',
      previous_filename: 'packages/cortico-world-desktop-pet/web/whale/figure.js', status: 'renamed' } },
    { kind: 'side geometry', file: { filename: 'packages/cortico-world-desktop-pet/host/window-surfaces.cjs', status: 'modified' } },
  ])('flags $kind for desktop preservation review', async ({ file }) => {
    const { source } = publicFetch((route, value) => route.startsWith('Coopanion/') && route.includes('compare/')
      ? { ...value, files: [{ ...file, additions: 1, deletions: 1, patch: '-old\n+new' }] } : value);
    const changes = await source.diff(release, new AbortController().signal);
    expect(changes.overlaps).toContain('computerUse');
    expect(changes.files[0]?.previousPath).toBe(file.previous_filename);
  });

  it('rejects prereleases and malformed tags before constructing more requests', async () => {
    for (const data of [{ prerelease: true }, { tag_name: '../private' }, { tag_name: 'v1.2.3-beta' }]) {
      const { source } = publicFetch((route, value) => route.endsWith('releases/latest') ? { ...value, ...data } : value);
      await expect(source.latest(new AbortController().signal)).rejects.toThrow();
    }
    expect(isNewerUpstream('0.1.27', '0.1.26')).toBe(true);
    expect(isNewerUpstream('0.1.25', '0.1.26')).toBe(false);
    expect(isNewerUpstream('v0.1.27-beta', '0.1.26')).toBe(false);
  });

  it('rejects local-looking paths and flags missing or capped public data', async () => {
    const bad = publicFetch((route, value) => route.includes('compare/') ? { ...value, files: [{ filename: '../secret', additions: 1 }] } : value);
    await expect(bad.source.diff(release, new AbortController().signal)).rejects.toThrow('path');
    const limited = publicFetch((route, value) => route.includes('compare/') ? { status: 'diverged', files: Array.from({ length: 300 }, (_, i) => ({ filename: `file-${i}`, additions: 1, deletions: 0 })) } : value);
    const result = await limited.source.diff(release, new AbortController().signal);
    expect(result.limitations).toEqual(expect.arrayContaining(['files-capped', 'patches-omitted', 'diverged']));
    const submodule = publicFetch((route, value) => route.startsWith('Cortico/') ? { message: 'Unavailable' } : value);
    expect((await submodule.source.diff(release, new AbortController().signal)).limitations).toContain('submodule-unavailable');
    const binary = publicFetch((route, value) => route.includes('compare/') ? { status: 'ahead', files: [{ filename: 'asset.bin', status: 'modified', additions: 0, deletions: 0 }] } : value);
    expect((await binary.source.diff(release, new AbortController().signal)).limitations).toContain('patches-omitted');
  });

  it('rejects redirects and oversized JSON without quoting the response', async () => {
    const redirected = new Response('{}'); Object.defineProperty(redirected, 'redirected', { value: true });
    for (const response of [redirected, new Response('x'.repeat(2_000_001))]) {
      const source = new PublicUpstreamSource((async () => response) as typeof fetch);
      await expect(source.latest(new AbortController().signal)).rejects.toThrow(/Public upstream/);
    }
  });
});

describe('subscription review and local lifecycle', () => {
  it('assembles the review from a completed subscription response', async () => {
    const f = fixture();
    await expect(reviewUpstream({ client: f.client, model: 'fixture-model' }, release, structuredClone(diff), 'en', new AbortController().signal)).resolves.toEqual(analysis);
  });
  it('checks every six hours, calls the subscription once per version and reuses the report after restart', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const f = fixture();
    f.watch.start(); await f.watch.check();
    expect(f.sent).toHaveLength(1);
    expect(f.watch.snapshot()).toMatchObject({ phase: 'ready', nextCheckAt: Date.now() + CHECK_EVERY_MS });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 60_000);
    expect(f.checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.checks()).toBe(2); expect(f.sent).toHaveLength(1);
    await f.watch.stop();
    const resumed = fixture({ dir: f.dir });
    resumed.watch.start(); await resumed.watch.check(true);
    expect(resumed.watch.snapshot().phase).toBe('ready'); expect(resumed.sent).toHaveLength(0);
    expect(existsSync(join(f.dir, 'reports', `${UPSTREAM_BASE.version}-to-${NEXT}.json`))).toBe(true);
  });

  it('single-flights simultaneous checks and never reads private files into the review', async () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'private-source.ts'), 'PRIVATE-SOURCE-MARKER');
    f.watch.start();
    await Promise.all([f.watch.check(true), f.watch.check(true), f.watch.check(true)]);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).not.toContain('PRIVATE-SOURCE-MARKER');
    expect(f.sent[0]).not.toContain('fixture-only-token');
    const body = JSON.parse(f.sent[0]!);
    expect(body.input).toHaveLength(1); expect(body.store).toBe(false);
    expect(body.instructions).toContain('不可信任');
  });

  it('uses no subscription when the official baseline is current, and reviews a later release after a skip', async () => {
    let version = UPSTREAM_BASE.version as string;
    let notifications = 0;
    const f = fixture({ source: { latest: async () => ({ ...release, version, tag: `v${version}`,
      url: `https://github.com/Pal-AI-Lab/Coopanion/releases/tag/v${version}` }), diff: async () => structuredClone(diff) },
    canNotify: () => true, notify: () => { notifications++; return { answer: Promise.resolve('skip'), close() {} }; } });
    f.watch.start(); await f.watch.check();
    expect(f.watch.snapshot().phase).toBe('current'); expect(f.sent).toHaveLength(0);
    version = NEXT; await f.watch.check(true);
    version = '9.2.0'; await f.watch.check(true); await Promise.resolve();
    expect(f.sent).toHaveLength(2); expect(notifications).toBe(2);
    expect(f.watch.snapshot().decision?.key).toBe(`${UPSTREAM_BASE.version}:9.2.0`);
  });

  it('waits without a model request when the subscription is missing or automatic runs are paused', async () => {
    let available = false; let paused = false;
    const f = fixture({ subscription: () => available ? { client: f.client, model: 'fixture-model' } : null, paused: () => paused });
    f.watch.start(); await f.watch.check();
    expect(f.watch.snapshot()).toMatchObject({ phase: 'waiting-subscription', failure: 'subscription' }); expect(f.sent).toHaveLength(0);
    paused = true;
    await f.watch.check(); expect(f.watch.snapshot().failure).toBe('subscription');
    available = true; paused = true;
    await f.watch.check(); expect(f.sent).toHaveLength(0);
    expect(f.watch.snapshot().failure).toBe('paused');
    await f.watch.check(true); expect(f.sent).toHaveLength(1);
  });

  it('binds the subscription endpoint even when an API endpoint is active, and refuses a replaced subscription kind', async () => {
    const f = fixture();
    const module = createChatGPTModule(session, () => {});
    const config = { activeProvider: 'fixture-api', providers: {
      [CHATGPT_ENDPOINT]: { kind: CHATGPT_KIND, baseUrl: 'https://api.openai.com/v1', spec: { model: 'fixture-model', thinking: true } },
      'fixture-api': { kind: 'openai-responses-compat', baseUrl: 'https://fixture.invalid/v1', spec: { model: 'other-fixture', thinking: false } },
    } };
    const bound: string[] = [];
    const registry = { bind: (name: string) => { bound.push(name); return f.client; } };
    expect(upstreamSubscription(config, session, module, registry, 'en')?.model).toBe('fixture-model');
    expect(bound).toEqual([CHATGPT_ENDPOINT]);
    config.providers[CHATGPT_ENDPOINT]!.kind = 'openai-responses-compat';
    expect(upstreamSubscription(config, session, module, registry, 'en')).toBeNull();
    expect(bound).toEqual([CHATGPT_ENDPOINT]);
  });

  it('never automatically repeats a failed analysis, including after restart; retry is explicit', async () => {
    let calls = 0;
    const f = fixture({}, (async () => { calls++; return sse(calls === 1 ? 'invalid JSON' : JSON.stringify(analysis)); }) as typeof fetch);
    f.watch.start(); await f.watch.check();
    expect(f.watch.snapshot()).toMatchObject({ phase: 'failed', error: 'analysis', failure: 'review-format' });
    await f.watch.check(true); expect(calls).toBe(1);
    expect(f.watch.snapshot().failure).toBe('review-format');
    await f.watch.stop();
    const resumed = fixture({ dir: f.dir });
    resumed.watch.start(); await resumed.watch.check(true); expect(resumed.sent).toHaveLength(0);
    expect(resumed.watch.snapshot().failure).toBe('review-format');
    await resumed.watch.check(true, true); expect(resumed.sent).toHaveLength(1);
    expect(resumed.watch.snapshot()).toMatchObject({ phase: 'ready', error: null, failure: null });
  });

  it('stops on quota errors without a paid fallback or an automatic analysis retry', async () => {
    let calls = 0;
    const f = fixture({}, (async () => { calls++; return new Response(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }), { status: 429 }); }) as typeof fetch);
    f.watch.start(); await f.watch.check(); await f.watch.check(true);
    expect(calls).toBe(1); expect(f.watch.snapshot().report).toBeNull();
    expect(f.watch.snapshot().failure).toBe('usage-limit');
  });

  it.each([
    ['subscription_sharing_usage_limit_exceeded', 'usage-limit'],
    ['subscription_sharing_invalid_user', 'authorization'],
    ['chatpass_v2_scope_not_authorized', 'permission'],
    ['subscription_sharing_usage_unavailable', 'unavailable'],
    ['subscription_sharing_unsupported_capability', 'unsupported'],
  ])('retains %s through scheduled checks and restart without private text or new inference', async (code, failure) => {
    let calls = 0; let now = 1;
    const f = fixture({ now: () => now }, (async () => {
      calls++;
      return new Response(`data: ${JSON.stringify({ type: 'response.failed', response: { error: { code, message: 'PRIVATE-CREDENTIAL-TEXT' } } })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch);
    f.watch.start(); await f.watch.check();
    expect(f.watch.snapshot()).toMatchObject({ phase: 'failed', error: 'analysis', failure });
    now += CHECK_EVERY_MS;
    await f.watch.check();
    expect(f.watch.snapshot().failure).toBe(failure); expect(calls).toBe(1);
    expect(readFileSync(join(f.dir, 'state.json'), 'utf8')).not.toContain('PRIVATE');
    await f.watch.stop();
    const resumed = fixture({ dir: f.dir, now: () => now });
    resumed.watch.start(); await resumed.watch.check(true);
    expect(resumed.watch.snapshot().failure).toBe(failure); expect(resumed.sent).toHaveLength(0);
  });

  it('loads older failed records without inventing a reason or repeating inference', async () => {
    const f = fixture({}, (async () => sse('invalid JSON')) as typeof fetch);
    f.watch.start(); await f.watch.check(); await f.watch.stop();
    const saved: Record<string, unknown> = f.watch.snapshot() as unknown as Record<string, unknown>;
    delete saved.failure;
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(saved));
    const resumed = fixture({ dir: f.dir });
    resumed.watch.start(); await resumed.watch.check(true);
    expect(resumed.watch.snapshot()).toMatchObject({ phase: 'failed', failure: null });
    expect(resumed.sent).toHaveLength(0);
  });

  it('replaces unrecognized stored reasons with a fixed category', async () => {
    const f = fixture(); f.watch.start(); await f.watch.check(); await f.watch.stop();
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify({ ...f.watch.snapshot(), failure: 'PRIVATE-CREDENTIAL-TEXT' }));
    const resumed = fixture({ dir: f.dir });
    expect(resumed.watch.snapshot().failure).toBe('unknown');
    expect(JSON.stringify(resumed.watch.snapshot())).not.toContain('PRIVATE');
  });

  it('shows a known subscription block before inference without starting an attempt', async () => {
    const f = fixture({ subscription: () => null, subscriptionFailure: () => 'permission' });
    f.watch.start(); await f.watch.check();
    expect(f.watch.snapshot()).toMatchObject({ phase: 'waiting-subscription', failure: 'permission', attempts: [] });
    expect(f.sent).toHaveLength(0);
  });

  it.each(['network', 'timeout'] as const)('records a public-source %s failure without exposing its message', async failure => {
    const f = fixture({ source: { latest: async () => { throw failure === 'timeout' ? new DOMException('PRIVATE-TEXT', 'TimeoutError') : new Error('PRIVATE-TEXT'); },
      diff: async () => structuredClone(diff) } });
    f.watch.start(); await f.watch.check();
    expect(f.watch.snapshot()).toMatchObject({ phase: 'failed', failure, attempts: [] });
    expect(JSON.stringify(f.watch.snapshot())).not.toContain('PRIVATE');
  });

  it('persists a skip decision and never nags the same release after restart', async () => {
    let notifications = 0;
    const f = fixture({ canNotify: () => true, notify: () => { notifications++; return { answer: Promise.resolve('skip'), close() {} }; } });
    f.watch.start(); await f.watch.check(); await Promise.resolve();
    expect(f.watch.snapshot().decision?.choice).toBe('skip');
    f.watch.offer(); await f.watch.check(true); expect(notifications).toBe(1);
    await f.watch.stop();
    const resumed = fixture({ dir: f.dir, canNotify: () => true, notify: f.options.notify });
    resumed.watch.start(); await resumed.watch.check(true); resumed.watch.offer();
    expect(notifications).toBe(1); expect(resumed.sent).toHaveLength(0);
  });

  it('saves selected features and a private note locally without installing or submitting anything', async () => {
    const f = fixture(); f.watch.start(); await f.watch.check();
    const key = f.watch.snapshot().report!.key;
    expect(() => f.watch.decide('stale', 'update', ['credentials'], '')).toThrow();
    expect(() => f.watch.decide(key, 'update', ['../secret'], '')).toThrow();
    f.watch.decide(key, 'update', ['credentials', 'subscription', 'computerUse'], 'PRIVATE-LOCAL-NOTE');
    const request = f.watch.request()!;
    expect(request.path.startsWith(join(f.dir, 'requests'))).toBe(true);
    expect(request.text).toContain('PRIVATE-LOCAL-NOTE');
    expect(request.text).toContain(upstreamText('zh-Hant').featureNames.credentials);
    expect(request.text).toContain(upstreamText('zh-Hant').featureNames.computerUse);
    expect(request.text).not.toContain(`- ${upstreamText('zh-Hant').featureNames.models}`);
    expect(request.text).toContain('完成測試、憑證與私人資訊審核後');
    expect(request.text).toContain('備份到自己的 fork');
    expect(request.text).toContain('禁止 push 至上游、PR');
    await f.watch.check(true); expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).not.toContain('PRIVATE-LOCAL-NOTE');
  });

  it.each(['disable', 'stop'])('%s during an in-flight response prevents a late report and preserves the durable attempt', async action => {
    let releaseWire!: (response: Response) => void;
    const f = fixture({}, (() => new Promise<Response>(resolve => { releaseWire = resolve; })) as typeof fetch);
    f.watch.start(); const job = f.watch.check();
    await vi.waitFor(() => expect(f.watch.snapshot().phase).toBe('analyzing'));
    const canceled = action === 'stop' ? f.watch.stop() : Promise.resolve(f.watch.setEnabled(false));
    releaseWire(sse()); await job; await canceled;
    expect(f.watch.snapshot()).toMatchObject({ enabled: action === 'stop', phase: 'interrupted', report: null });
    expect(f.watch.snapshot().attempts).toHaveLength(1);
    expect(existsSync(join(f.dir, 'reports'))).toBe(false);
  });

  it('disables automatic work on corrupt local state rather than losing the attempt record silently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coo-upstream-corrupt-')); dirs.push(dir);
    writeFileSync(join(dir, 'state.json'), '{broken');
    const f = fixture({ dir });
    expect(f.watch.snapshot()).toMatchObject({ enabled: false, phase: 'failed', error: 'storage' });
  });

  it('does not consume subscription usage if the attempt cannot be saved', async () => {
    const f = fixture();
    mkdirSync(join(f.dir, 'state.json.tmp'));
    f.watch.start(); await f.watch.check();
    expect(f.sent).toHaveLength(0);
    expect(f.watch.snapshot()).toMatchObject({ enabled: false, phase: 'failed', error: 'storage' });
  });

  it('advances the public baseline without deleting historical reports or enabling a disabled tracker', async () => {
    const f = fixture(); f.watch.start(); await f.watch.check(); await f.watch.stop();
    const reportPath = join(f.dir, 'reports', `${UPSTREAM_BASE.version}-to-${NEXT}.json`);
    const originalReport = readFileSync(reportPath, 'utf8');
    const saved = f.watch.snapshot();
    saved.baseline = '0.0.1'; saved.enabled = false;
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(saved));
    const upgraded = fixture({ dir: f.dir });
    upgraded.watch.start(); await upgraded.watch.check(true);
    expect(upgraded.watch.snapshot()).toMatchObject({ baseline: UPSTREAM_BASE.version, enabled: false, report: null, attempts: [] });
    expect(readFileSync(reportPath, 'utf8')).toBe(originalReport);
    expect(upgraded.sent).toHaveLength(0);
  });
});

describe('review boundaries and translations', () => {
  it('requires a bounded JSON review covering every personal feature exactly once', () => {
    expect(parseReview(JSON.stringify(analysis))).toEqual(analysis);
    expect(() => parseReview(JSON.stringify({ ...analysis, features: [...analysis.features.slice(1), analysis.features[1]] }))).toThrow();
    expect(() => parseReview(JSON.stringify({ ...analysis, risks: ['x'.repeat(1601)] }))).toThrow();
    expect(() => parseReview('```json\n{}\n```')).toThrow();
  });

  it('marks the public input as incomplete when a large patch exceeds the review budget', () => {
    const changes = structuredClone(diff); changes.files[0]!.patch = 'x'.repeat(100_000);
    const input = reviewInput(release, changes);
    expect(input.length).toBeLessThanOrEqual(72_000);
    expect(changes.limitations).toContain('input-truncated');
    expect(JSON.parse(input).files[0].patch.length).toBeLessThan(100_000);
  });

  it('has complete UI, status and feature names in all supported languages', () => {
    for (const language of LANGUAGES) {
      const s = upstreamText(language);
      expect(Object.values(s).every(value => typeof value === 'string' ? value.trim() : value !== null && typeof value === 'object')).toBe(true);
      expect(Object.keys(s.phases)).toHaveLength(8);
      expect(Object.keys(s.featureNames)).toHaveLength(PERSONAL_FEATURES.length);
      expect(Object.values(s.phases).every(Boolean)).toBe(true);
      expect(Object.keys(s.failures)).toEqual([...UPSTREAM_FAILURES]);
      expect(Object.values(s.failures).every(value => typeof value === 'string' && value.trim())).toBe(true);
    }
  });
});
