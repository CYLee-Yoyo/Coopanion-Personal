/** Reads only the public upstream repositories. No Git credentials, private refs, or local source enter requests. */
import { featureOverlaps, UPSTREAM_BASE } from './personal-upstream.ts';
import type { UpstreamDiff, UpstreamFile, UpstreamRelease } from './upstream-types.ts';

export const PUBLIC_API = 'https://api.github.com/repos/Pal-AI-Lab/';
export const PUBLIC_SITE = 'https://github.com/Pal-AI-Lab/';
const MAX_JSON_BYTES = 2_000_000;
const TIMEOUT_MS = 20_000;
const SHA = /^[0-9a-f]{40}$/;
const TAG = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

export function isNewerUpstream(latest: string, current: string): boolean {
  const a = TAG.exec(latest)?.slice(1).map(Number), b = TAG.exec(current)?.slice(1).map(Number);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

const string = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : '';
const pathOf = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\x00-\x1f\\]/.test(value) || value.startsWith('/') || value.includes(':') || value.split('/').some(p => p === '..')) throw new Error('Invalid public diff path');
  return value;
};

export class PublicUpstreamSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async json(repository: 'Coopanion' | 'Cortico', route: string, signal: AbortSignal): Promise<any> {
    const response = await this.fetchImpl(`${PUBLIC_API}${repository}/${route}`, {
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Coopanion-Personal-release-watch' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!response.ok || response.redirected || !response.body) throw new Error('Public upstream request failed');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '', size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_JSON_BYTES) throw new Error('Public upstream response too large');
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally { await reader.cancel().catch(() => {}); }
  }

  async latest(signal: AbortSignal): Promise<UpstreamRelease> {
    const data = await this.json('Coopanion', 'releases/latest', signal);
    const tag = string(data.tag_name, 60), match = TAG.exec(tag);
    if (!match || data.draft !== false || data.prerelease !== false) throw new Error('Invalid stable upstream release');
    return { version: match.slice(1).join('.'), tag, title: string(data.name, 200), notes: string(data.body, 20_000),
      url: `${PUBLIC_SITE}Coopanion/releases/tag/${encodeURIComponent(tag)}`,
      publishedAt: typeof data.published_at === 'string' && Number.isFinite(Date.parse(data.published_at)) ? data.published_at.slice(0, 80) : null };
  }

  private async head(tag: string, signal: AbortSignal): Promise<string> {
    if (!TAG.test(tag)) throw new Error('Invalid upstream tag');
    let data = await this.json('Coopanion', `git/ref/tags/${encodeURIComponent(tag)}`, signal);
    for (let depth = 0; depth < 3; depth++) {
      if (!SHA.test(data.object?.sha ?? '')) throw new Error('Invalid public commit');
      if (data.object.type === 'commit') return data.object.sha as string;
      if (data.object.type !== 'tag') break;
      data = await this.json('Coopanion', `git/tags/${data.object.sha}`, signal);
    }
    throw new Error('Public tag does not resolve to a commit');
  }

  private async compare(repository: 'Coopanion' | 'Cortico', base: string, head: string, signal: AbortSignal): Promise<{ files: UpstreamFile[]; limitations: UpstreamDiff['limitations'] }> {
    if (!SHA.test(base) || !SHA.test(head)) throw new Error('Invalid public comparison');
    const data = await this.json(repository, `compare/${base}...${head}?per_page=1`, signal);
    if (!Array.isArray(data.files) || !['ahead', 'identical', 'diverged', 'behind'].includes(data.status)) throw new Error('Invalid public comparison');
    const limitations: UpstreamDiff['limitations'] = [];
    if (data.files.length >= 300) limitations.push('files-capped');
    if (data.status === 'diverged' || data.status === 'behind') limitations.push('diverged');
    if (data.files.some((file: any) => typeof file.patch === 'string' && file.patch.length > 160_000)) limitations.push('input-truncated');
    const files = data.files.slice(0, 300).map((file: any): UpstreamFile => ({ repository,
      path: pathOf(file.filename), ...(file.previous_filename ? { previousPath: pathOf(file.previous_filename) } : {}),
      status: string(file.status, 30), additions: Number.isSafeInteger(file.additions) ? file.additions : 0,
      deletions: Number.isSafeInteger(file.deletions) ? file.deletions : 0, patch: typeof file.patch === 'string' ? file.patch.slice(0, 160_000) : null,
    }));
    if (files.some((f: UpstreamFile) => f.patch === null)) limitations.push('patches-omitted');
    return { files, limitations };
  }

  async diff(release: UpstreamRelease, signal: AbortSignal): Promise<UpstreamDiff> {
    const head = await this.head(release.tag, signal);
    const root = await this.compare('Coopanion', UPSTREAM_BASE.commit, head, signal);
    const link = root.files.find(file => file.path === 'vendor/cortico');
    if (link) {
      const next = /^\+Subproject commit ([0-9a-f]{40})$/m.exec(link.patch ?? '')?.[1];
      if (next) {
        try {
          const dependency = await this.compare('Cortico', UPSTREAM_BASE.corticoCommit, next, signal);
          root.files.push(...dependency.files);
          root.limitations.push(...dependency.limitations);
        } catch { if (signal.aborted) throw signal.reason; root.limitations.push('submodule-unavailable'); }
      } else root.limitations.push('submodule-unavailable');
    }
    return { head, compareUrl: `${PUBLIC_SITE}Coopanion/compare/${UPSTREAM_BASE.commit}...${head}`,
      files: root.files, overlaps: featureOverlaps(root.files.filter(file => file.repository === 'Coopanion')),
      limitations: [...new Set(root.limitations)] };
  }
}
