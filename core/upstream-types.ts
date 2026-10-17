/** Public data and local report shapes shared by the release watcher and settings page. */
import type { PersonalFeatureId } from './personal-upstream.ts';

export interface UpstreamRelease { version: string; tag: string; title: string; notes: string; url: string; publishedAt: string | null }
export interface UpstreamFile { repository: 'Coopanion' | 'Cortico'; path: string; previousPath?: string; status: string; additions: number; deletions: number; patch: string | null }
export interface UpstreamDiff {
  head: string; compareUrl: string; files: UpstreamFile[]; overlaps: PersonalFeatureId[];
  limitations: Array<'files-capped' | 'patches-omitted' | 'diverged' | 'submodule-unavailable' | 'input-truncated'>;
}
export interface UpstreamAnalysis {
  summary: string; changes: string[]; risks: string[]; recommendation: string;
  features: Array<{ id: PersonalFeatureId; assessment: string }>;
}
export interface UpstreamReport {
  key: string; release: UpstreamRelease; baseline: string; head: string; compareUrl: string;
  changedFiles: Array<Omit<UpstreamFile, 'patch'>>; overlaps: PersonalFeatureId[];
  limitations: UpstreamDiff['limitations']; analysis: UpstreamAnalysis; model: string; analyzedAt: number;
}
export type UpstreamDecision = { key: string; choice: 'update' | 'skip'; keep: PersonalFeatureId[]; note: string; at: number };
export type UpstreamPhase = 'idle' | 'checking' | 'current' | 'waiting-subscription' | 'analyzing' | 'ready' | 'failed' | 'interrupted';
export const UPSTREAM_FAILURES = ['usage-limit', 'authorization', 'permission', 'ineligible', 'unavailable', 'unsupported',
  'network', 'timeout', 'response', 'unknown', 'subscription', 'paused', 'review-format', 'storage'] as const;
export type UpstreamFailure = (typeof UPSTREAM_FAILURES)[number];
export interface UpstreamState {
  schema: 1; enabled: boolean; intervalHours: 6; baseline: string; installedVersion: string;
  phase: UpstreamPhase; lastAttemptAt: number | null; lastCheckedAt: number | null; nextCheckAt: number | null;
  latest: UpstreamRelease | null; report: UpstreamReport | null; decision: UpstreamDecision | null;
  attempts: string[]; notified: string[]; error: 'network' | 'analysis' | 'subscription' | 'storage' | null;
  failure: UpstreamFailure | null;
  requestSaved: boolean;
}
