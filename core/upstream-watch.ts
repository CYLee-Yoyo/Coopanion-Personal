/** Local release checks, durable review attempts and explicit manual-integration requests. */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from 'cortico/core/language.ts';
import { ChatGPTError } from 'cortico-provider-coo/src/chatgpt/client.ts';
import { PERSONAL_FEATURES, UPSTREAM_BASE, type PersonalFeatureId } from './personal-upstream.ts';
import { isNewerUpstream, PublicUpstreamSource } from './upstream-source.ts';
import { parseReview, reviewUpstream, UpstreamReviewError, type SubscriptionReviewBinding } from './upstream-review.ts';
import { upstreamText } from './upstream-strings.ts';
import { UPSTREAM_FAILURES, type UpstreamDecision, type UpstreamFailure, type UpstreamReport, type UpstreamState } from './upstream-types.ts';

export const CHECK_EVERY_MS = 6 * 60 * 60_000;
type PetChoice = 'view' | 'update' | 'skip' | 'closed' | 'unavailable';
export interface UpstreamWatchOptions {
  dir: string;
  installedVersion: string;
  language: () => Language;
  subscription: () => SubscriptionReviewBinding | null;
  subscriptionFailure?: () => UpstreamFailure | null;
  retrySubscription?: () => void;
  paused: () => boolean;
  canNotify: () => boolean;
  notify: (report: UpstreamReport) => { answer: Promise<PetChoice>; close(): void };
  source?: Pick<PublicUpstreamSource, 'latest' | 'diff'>;
  now?: () => number;
}

const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const phaseNames = ['idle', 'checking', 'current', 'waiting-subscription', 'analyzing', 'ready', 'failed', 'interrupted'];
const keyOf = (version: string) => `${UPSTREAM_BASE.version}:${version}`;
function atomic(path: string, text: string): void { writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); }

export class UpstreamWatch {
  private state: UpstreamState;
  private readonly source: Pick<PublicUpstreamSource, 'latest' | 'diff'>;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flight: Promise<UpstreamState> | null = null;
  private controller: AbortController | null = null;
  private dialog: { close(): void } | null = null;
  private stopped = true;

  constructor(private readonly options: UpstreamWatchOptions) {
    this.source = options.source ?? new PublicUpstreamSource();
    this.now = options.now ?? Date.now;
    this.state = this.load();
  }

  private defaults(): UpstreamState {
    return { schema: 1, enabled: true, intervalHours: 6, baseline: UPSTREAM_BASE.version, installedVersion: this.options.installedVersion,
      phase: 'idle', lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, latest: null, report: null, decision: null,
      attempts: [], notified: [], error: null, failure: null, requestSaved: false };
  }

  private load(): UpstreamState {
    const path = join(this.options.dir, 'state.json');
    const fresh = this.defaults();
    if (!existsSync(path)) return fresh;
    try {
      if (statSync(path).size > 2_000_000) throw new Error('Invalid release state');
      const saved = JSON.parse(readFileSync(path, 'utf8')) as UpstreamState;
      if (saved.schema !== 1 || typeof saved.enabled !== 'boolean' || !phaseNames.includes(saved.phase)
        || !Array.isArray(saved.attempts) || !Array.isArray(saved.notified)
        || [...saved.attempts, ...saved.notified].some(key => typeof key !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}:\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(key))) throw new Error('Invalid release state');
      if (saved.baseline !== UPSTREAM_BASE.version) return { ...fresh, enabled: saved.enabled };
      for (const at of [saved.lastAttemptAt, saved.lastCheckedAt, saved.nextCheckAt]) if (at !== null && (!Number.isSafeInteger(at) || at < 0)) throw new Error('Invalid release state');
      if (saved.latest && (!VERSION.test(saved.latest.version) || saved.latest.tag.replace(/^v/, '') !== saved.latest.version
        || saved.latest.url !== `https://github.com/Pal-AI-Lab/Coopanion/releases/tag/${encodeURIComponent(saved.latest.tag)}`)) throw new Error('Invalid release state');
      if (saved.report) {
        if (saved.report.key !== keyOf(saved.report.release.version) || !/^[0-9a-f]{40}$/.test(saved.report.head)
          || saved.report.compareUrl !== `https://github.com/Pal-AI-Lab/Coopanion/compare/${UPSTREAM_BASE.commit}...${saved.report.head}`
          || !Array.isArray(saved.report.changedFiles) || saved.report.changedFiles.length > 600) throw new Error('Invalid release state');
        saved.report.analysis = parseReview(JSON.stringify(saved.report.analysis));
      }
      if (saved.decision && (saved.decision.key !== saved.report?.key || !['update', 'skip'].includes(saved.decision.choice)
        || !Array.isArray(saved.decision.keep) || saved.decision.keep.some(id => !PERSONAL_FEATURES.some(f => f.id === id))
        || typeof saved.decision.note !== 'string' || saved.decision.note.length > 4000)) throw new Error('Invalid release state');
      return { ...saved, installedVersion: fresh.installedVersion, intervalHours: 6,
        failure: saved.failure == null ? null : UPSTREAM_FAILURES.includes(saved.failure) ? saved.failure : 'unknown',
        phase: saved.phase === 'analyzing' ? 'interrupted' : saved.phase === 'checking' ? 'idle' : saved.phase };
    } catch { return { ...fresh, enabled: false, phase: 'failed', error: 'storage', failure: 'storage' }; }
  }

  snapshot(): UpstreamState { return structuredClone(this.state); }

  private save(patch: Partial<UpstreamState>): void {
    const next = { ...this.state, ...patch };
    mkdirSync(this.options.dir, { recursive: true });
    atomic(join(this.options.dir, 'state.json'), `${JSON.stringify(next, null, 2)}\n`);
    this.state = next;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.dialog?.close();
    if (this.state.phase === 'analyzing' || this.state.phase === 'checking') {
      try { this.save({ phase: this.state.phase === 'analyzing' ? 'interrupted' : 'idle' }); }
      catch { this.state.error = 'storage'; this.state.failure = 'storage'; }
    }
    await this.flight;
  }

  private tick(): void {
    if (!this.state.enabled || this.stopped) return;
    const waiting = this.state.phase === 'waiting-subscription' && !this.options.paused() && this.options.subscription() !== null;
    if (waiting || this.state.nextCheckAt === null || this.now() >= this.state.nextCheckAt) void this.check();
    this.offer();
  }

  setEnabled(value: unknown): UpstreamState {
    if (typeof value !== 'boolean') throw new Error('Invalid release setting');
    this.save({ enabled: value, nextCheckAt: value ? this.state.nextCheckAt : null,
      ...(this.state.phase === 'analyzing' ? { phase: 'interrupted' as const } : this.state.phase === 'checking' ? { phase: 'idle' as const } : {}) });
    if (!value) { this.controller?.abort(); this.dialog?.close(); }
    else this.tick();
    return this.snapshot();
  }

  /** Console calls return immediately; the accepted job survives page navigation. */
  requestCheck(retry = false): UpstreamState { void this.check(true, retry); return this.snapshot(); }

  check(manual = false, retry = false): Promise<UpstreamState> {
    if (this.flight) return this.flight;
    if (!this.state.enabled || this.stopped) return Promise.resolve(this.snapshot());
    const controller = new AbortController();
    this.controller = controller;
    this.flight = this.run(manual, retry, controller.signal).finally(() => { this.flight = null; this.controller = null; this.offer(); });
    return this.flight;
  }

  private async run(manual: boolean, retry: boolean, signal: AbortSignal): Promise<UpstreamState> {
    let stage: 'network' | 'analysis' | 'storage' = 'network';
    const previous = { error: this.state.error, failure: this.state.failure };
    try {
      this.save({ phase: 'checking', lastAttemptAt: this.now(), nextCheckAt: this.now() + CHECK_EVERY_MS });
      const latest = await this.source.latest(signal);
      signal.throwIfAborted();
      const key = keyOf(latest.version);
      const same = this.state.latest?.version === latest.version;
      this.save({ latest, lastCheckedAt: this.now(), ...(same ? {} : { report: null, decision: null, requestSaved: false, error: null, failure: null }) });
      if (!isNewerUpstream(latest.version, UPSTREAM_BASE.version)) { this.save({ phase: 'current', error: null, failure: null }); return this.snapshot(); }
      if (this.state.report?.key === key) { this.save({ phase: 'ready', error: null, failure: null }); return this.snapshot(); }
      if (this.state.attempts.includes(key) && !retry) {
        const failed = same && previous.error !== null;
        this.save({ phase: failed ? 'failed' : 'interrupted', error: failed ? previous.error : null, failure: failed ? previous.failure : null });
        return this.snapshot();
      }
      if (manual && retry) this.options.retrySubscription?.();
      const binding = this.options.subscription();
      if (!binding || (!manual && this.options.paused())) { this.waitForSubscription(); return this.snapshot(); }
      const diff = await this.source.diff(latest, signal);
      signal.throwIfAborted();
      // Authorization can be revoked while public changes are loading.
      if (!this.options.subscription() || (!manual && this.options.paused())) { this.waitForSubscription(); return this.snapshot(); }
      stage = 'analysis';
      this.save({ phase: 'analyzing', error: null, failure: null, attempts: [...new Set([...this.state.attempts, key])] });
      const analysis = await reviewUpstream(binding, latest, diff, this.options.language(), signal);
      signal.throwIfAborted();
      const report: UpstreamReport = { key, release: latest, baseline: UPSTREAM_BASE.version, head: diff.head, compareUrl: diff.compareUrl,
        changedFiles: diff.files.map(({ patch: _patch, ...file }) => file), overlaps: diff.overlaps, limitations: diff.limitations,
        analysis, model: binding.model, analyzedAt: this.now() };
      stage = 'storage';
      mkdirSync(join(this.options.dir, 'reports'), { recursive: true });
      atomic(this.artifact('reports', latest.version, 'json'), `${JSON.stringify(report, null, 2)}\n`);
      this.save({ report, phase: 'ready', error: null, failure: null });
    } catch (error) {
      if (!signal.aborted) {
        const failure = error instanceof ChatGPTError ? error.reason : error instanceof UpstreamReviewError ? 'review-format'
          : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : stage === 'analysis' ? 'unknown' : stage;
        try { this.save({ phase: 'failed', error: stage, failure }); }
        catch { this.state.phase = 'failed'; this.state.error = 'storage'; this.state.failure = 'storage'; this.state.enabled = false; }
      }
    }
    return this.snapshot();
  }

  private waitForSubscription(): void {
    this.save({ phase: 'waiting-subscription', error: 'subscription',
      failure: this.options.subscriptionFailure?.() ?? (this.options.subscription() === null ? 'subscription' : 'paused') });
  }

  private artifact(kind: 'reports' | 'requests', version: string, extension: 'json' | 'md'): string {
    if (!VERSION.test(version)) throw new Error('Invalid release artifact');
    return join(this.options.dir, kind, `${UPSTREAM_BASE.version}-to-${version}.${extension}`);
  }

  decide(key: unknown, choice: unknown, keep: unknown, note: unknown): UpstreamState {
    if (!this.state.report || key !== this.state.report.key || !['update', 'skip'].includes(String(choice))
      || !Array.isArray(keep) || keep.some(id => !PERSONAL_FEATURES.some(f => f.id === id))
      || typeof note !== 'string' || note.length > 4000) throw new Error('Invalid update decision');
    const decision: UpstreamDecision = { key: this.state.report.key, choice: choice as 'update' | 'skip',
      keep: [...new Set(keep)] as PersonalFeatureId[], note: note.trim(), at: this.now() };
    if (decision.choice === 'update') {
      mkdirSync(join(this.options.dir, 'requests'), { recursive: true });
      atomic(this.artifact('requests', this.state.report.release.version, 'md'), this.handoff(this.state.report, decision));
    }
    this.save({ decision, requestSaved: decision.choice === 'update' });
    return this.snapshot();
  }

  request(): { path: string; text: string } | null {
    if (!this.state.requestSaved || this.state.decision?.choice !== 'update' || !this.state.report) return null;
    const path = this.artifact('requests', this.state.report.release.version, 'md');
    return { path, text: readFileSync(path, 'utf8') };
  }

  private handoff(report: UpstreamReport, decision: UpstreamDecision): string {
    const s = upstreamText(this.options.language());
    return [`# Coopanion Personal: ${report.baseline} → ${report.release.version}`, '', s.handoffRule, '',
      `${s.installed}: ${this.options.installedVersion}`, `${s.compare}: ${report.compareUrl}`,
      `${s.summary}: ${report.analysis.summary}`, `${s.files}: ${this.artifact('reports', report.release.version, 'json')}`, '',
      `## ${s.keep}`, ...decision.keep.map(id => `- ${s.featureNames[id]}`), '', `## ${s.note}`, decision.note || s.none, '',
      `## ${s.risks}`, ...report.analysis.risks.map(risk => `- ${risk}`), '', `${s.limitations}: ${report.limitations.join(', ') || '—'}`, s.limits, ''].join('\n');
  }

  offer(): void {
    const report = this.state.report;
    if (this.stopped || !this.state.enabled || this.state.phase !== 'ready' || !report || this.state.decision?.key === report.key
      || this.dialog || this.state.notified.includes(report.key) || !this.options.canNotify()) return;
    try {
      this.save({ notified: [...this.state.notified, report.key] });
      const dialog = this.options.notify(structuredClone(report));
      this.dialog = dialog;
      void dialog.answer.then(choice => {
        if (this.stopped || !this.state.enabled || this.state.report?.key !== report.key) return;
        if (choice === 'unavailable') this.save({ notified: this.state.notified.filter(key => key !== report.key) });
        else if (choice === 'skip' || choice === 'update') this.decide(report.key, choice, PERSONAL_FEATURES.map(f => f.id), '');
      }).catch(() => { this.state.error = 'storage'; }).finally(() => { if (this.dialog === dialog) this.dialog = null; });
    } catch { this.state.error = 'storage'; }
  }
}
