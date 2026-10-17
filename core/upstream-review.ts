/** Subscription-only inference over bounded public data; private source is never read. */
import type { ResponseClient } from 'cortico/core/generation.ts';
import type { Language } from 'cortico/core/language.ts';
import type { CoreConfig } from 'cortico/core/types.ts';
import type { ProviderModule } from 'cortico/providers/base.ts';
import type { ProviderRegistry } from 'cortico/providers/registry.ts';
import { CHATGPT_ENDPOINT, CHATGPT_KIND, type ChatGPTSession } from 'cortico-provider-coo/src/chatgpt/types.ts';
import { PERSONAL_FEATURES, UPSTREAM_BASE } from './personal-upstream.ts';
import { reviewInstructions } from './upstream-model-text.ts';
import type { UpstreamAnalysis, UpstreamDiff, UpstreamRelease } from './upstream-types.ts';

const INPUT_BUDGET = 72_000;
export interface SubscriptionReviewBinding { client: ResponseClient; model: string }
export class UpstreamReviewError extends Error {}

export function upstreamSubscription(config: Pick<CoreConfig, 'providers'>, session: ChatGPTSession, module: ProviderModule,
  registry: Pick<ProviderRegistry, 'bind'>, language: Language): SubscriptionReviewBinding | null {
  const entry = config.providers[CHATGPT_ENDPOINT];
  if (!entry || entry.kind !== CHATGPT_KIND || !entry.spec?.model || !session.status().sharing
    || !module.availability?.(CHATGPT_ENDPOINT, entry, language).ready) return null;
  return { client: registry.bind(CHATGPT_ENDPOINT), model: entry.spec.model };
}

export function reviewInput(release: UpstreamRelease, diff: UpstreamDiff): string {
  const truncate = () => { if (!diff.limitations.includes('input-truncated')) diff.limitations.push('input-truncated'); };
  if (release.notes.length > 6000) truncate();
  const header = { baseline: UPSTREAM_BASE, release: { version: release.version, title: release.title, notes: release.notes.slice(0, 6000) },
    head: diff.head, checklist: PERSONAL_FEATURES.map(({ id, description }) => ({ id, description })),
    fileOverlaps: diff.overlaps, limitations: diff.limitations, totalChangedFiles: diff.files.length };
  let remaining = INPUT_BUDGET - JSON.stringify(header).length - 300;
  const priority = (path: string) => PERSONAL_FEATURES.some(f => f.paths.some(p => path.startsWith(p))) ? 0 : 1;
  const files = [];
  for (const file of [...diff.files].sort((a, b) => priority(a.path) - priority(b.path))) {
    const copy = { ...file, patch: file.patch?.slice(0, Math.max(0, remaining)) ?? null };
    while (copy.patch && JSON.stringify(copy).length + 1 > remaining) copy.patch = copy.patch.slice(0, Math.floor(copy.patch.length / 2));
    if (JSON.stringify(copy).length + 1 > remaining) { truncate(); break; }
    if (copy.patch !== file.patch) truncate();
    remaining -= JSON.stringify(copy).length + 1;
    files.push(copy);
  }
  return JSON.stringify({ ...header, files });
}

export function parseReview(text: string): UpstreamAnalysis {
  if (text.length > 32_000) throw new Error('Invalid upstream review');
  const value = JSON.parse(text.trim()) as Record<string, unknown>;
  const line = (v: unknown): string => { if (typeof v !== 'string' || !v.trim() || v.length > 1600) throw new Error('Invalid upstream review'); return v.trim(); };
  const list = (v: unknown): string[] => { if (!Array.isArray(v) || v.length > 8) throw new Error('Invalid upstream review'); return v.map(line); };
  if (!Array.isArray(value.features) || value.features.length !== PERSONAL_FEATURES.length) throw new Error('Invalid upstream review');
  const features = PERSONAL_FEATURES.map(({ id }) => {
    const matches = (value.features as Array<Record<string, unknown>>).filter(f => f && f.id === id);
    if (matches.length !== 1) throw new Error('Invalid upstream review');
    return { id, assessment: line(matches[0]!.assessment) };
  });
  return { summary: line(value.summary), changes: list(value.changes), risks: list(value.risks), recommendation: line(value.recommendation), features };
}

export async function reviewUpstream(binding: SubscriptionReviewBinding, release: UpstreamRelease, diff: UpstreamDiff,
  language: Language, signal: AbortSignal): Promise<UpstreamAnalysis> {
  const generation = await binding.client.respond({ model: binding.model, instructions: reviewInstructions(language),
    input: [{ type: 'message', role: 'user', content: reviewInput(release, diff) }], tools: [], reasoning: { effort: 'low' } },
  { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]), role: 'upstream-review' });
  signal.throwIfAborted();
  if (generation.response.status !== 'completed' || generation.response.output.some(item => item.type !== 'message' && item.type !== 'reasoning')) throw new UpstreamReviewError('Incomplete upstream review');
  const text = generation.response.output.flatMap(item => item.type === 'message' && item.role === 'assistant'
    ? item.content.flatMap(part => part.type === 'output_text' ? [part.text] : []) : []).join('\n');
  try { return parseReview(text); }
  catch { throw new UpstreamReviewError('Invalid upstream review'); }
}
